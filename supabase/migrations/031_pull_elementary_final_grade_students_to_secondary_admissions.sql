-- Complete e-Dnevnik -> secondary admissions synchronization.
-- Pull only active 8th-grade elementary students, copy grades 5-7 immediately,
-- and let the trigger from migration 030 append grade 8 after e-Matica closes it.

create or replace function public.sync_admission_candidate_grade_summaries(
  p_candidate_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.admission_candidates;
  v_history record;
  v_summary record;
  v_history_school_level public.school_education_level;
  v_history_first_grade integer;
  v_history_last_grade integer;
  v_summary_last_grade integer;
  v_count integer := 0;
begin
  select * into v_candidate
  from public.admission_candidates
  where id = p_candidate_id;

  if v_candidate.id is null then
    raise exception 'Kandidat ne postoji: %', p_candidate_id;
  end if;

  if v_candidate.track = 'HIGHER_EDUCATION' then
    v_history_school_level := 'SECONDARY';
    v_history_first_grade := 1;
    v_history_last_grade := 3;
    v_summary_last_grade := 4;
  else
    v_history_school_level := 'ELEMENTARY';
    v_history_first_grade := 5;
    v_history_last_grade := 7;
    v_summary_last_grade := 8;
  end if;

  -- Create missing historical e-Matica summaries from e-Dnevnik final grades.
  -- The current/final grade is intentionally excluded and arrives later through
  -- the year-end trigger after it is closed in e-Matica.
  for v_history in
    select distinct
      c.id as class_id,
      c.grade_level,
      c.school_year_id
    from public.student_class_enrollments sce
    join public.classes c on c.id = sce.class_id
    join public.schools school on school.id = c.school_id
    where (
        sce.registry_student_id = v_candidate.registry_student_id
        or sce.student_id = v_candidate.ednevnik_student_id
        or sce.student_id = v_candidate.registry_student_id
      )
      and school.education_level = v_history_school_level
      and c.grade_level between v_history_first_grade and v_history_last_grade
      and exists (
        select 1
        from public.final_grades fg
        where fg.student_id = v_candidate.ednevnik_student_id
          and fg.class_id = c.id
      )
  loop
    if not exists (
      select 1
      from public.student_year_end_summaries ys
      where ys.registry_student_id = v_candidate.registry_student_id
        and ys.school_year_id is not distinct from v_history.school_year_id
    ) then
      perform public.pull_ednevnik_year_end_to_ematica(
        v_candidate.registry_student_id,
        v_history.class_id
      );
    end if;
  end loop;

  for v_summary in
    select
      ys.id,
      ys.registry_student_id,
      ys.class_id,
      ys.school_year_id,
      ys.final_grade_average,
      ys.final_success_text,
      ys.final_grades,
      c.grade_level
    from public.student_year_end_summaries ys
    join public.classes c on c.id = ys.class_id
    join public.schools school on school.id = c.school_id
    where ys.registry_student_id = v_candidate.registry_student_id
      and school.education_level = v_history_school_level
      and c.grade_level between v_history_first_grade and v_summary_last_grade
  loop
    insert into public.admission_candidate_grade_summaries (
      candidate_id,
      year_end_summary_id,
      registry_student_id,
      class_id,
      school_year_id,
      grade_level,
      final_grade_average,
      final_success_text,
      final_grades,
      source,
      synced_at
    )
    values (
      v_candidate.id,
      v_summary.id,
      v_summary.registry_student_id,
      v_summary.class_id,
      v_summary.school_year_id,
      v_summary.grade_level,
      v_summary.final_grade_average,
      v_summary.final_success_text,
      v_summary.final_grades,
      'EMATICA',
      now()
    )
    on conflict (candidate_id, grade_level)
    do update set
      year_end_summary_id = excluded.year_end_summary_id,
      registry_student_id = excluded.registry_student_id,
      class_id = excluded.class_id,
      school_year_id = excluded.school_year_id,
      final_grade_average = excluded.final_grade_average,
      final_success_text = excluded.final_success_text,
      final_grades = excluded.final_grades,
      source = excluded.source,
      synced_at = now(),
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

drop function if exists public.create_class_admission_candidates(
  text,
  public.admissions_track,
  uuid
);

create function public.create_class_admission_candidates(
  p_class_id text,
  p_track public.admissions_track,
  p_school_year_id uuid
)
returns table (
  registry_student_id uuid,
  candidate_id uuid,
  result text,
  grade_years_synced integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class record;
  v_enrollment record;
  v_registry_student_id uuid;
  v_ednevnik_student_id uuid;
  v_candidate_id uuid;
begin
  if p_school_year_id is null then
    raise exception 'Odaberite skolsku godinu.';
  end if;

  select
    c.id,
    c.school_id,
    c.school_year_id,
    c.name,
    c.grade_level,
    school.education_level
  into v_class
  from public.classes c
  join public.schools school on school.id = c.school_id
  where c.id = p_class_id;

  if v_class.id is null then
    raise exception 'Razred ne postoji: %', p_class_id;
  end if;

  if v_class.school_year_id is distinct from p_school_year_id then
    raise exception 'Odabrani razred ne pripada odabranoj skolskoj godini.';
  end if;

  if p_track = 'HIGHER_EDUCATION' and (
    v_class.education_level <> 'SECONDARY'
    or v_class.grade_level <> 4
    or upper(coalesce(btrim(v_class.name), '')) = '4.K'
  ) then
    raise exception 'Za upis na fakultet mogu se povuci samo ucenici 4. razreda, osim 4.K.';
  end if;

  if p_track = 'SECONDARY' and (
    v_class.education_level <> 'ELEMENTARY'
    or v_class.grade_level <> 8
  ) then
    raise exception 'Za upis u srednju mogu se povuci samo ucenici 8. razreda osnovne skole.';
  end if;

  for v_enrollment in
    select distinct
      sce.student_id,
      sce.registry_student_id,
      coalesce(
        registry_student.ednevnik_student_id,
        registry_by_student_id.ednevnik_student_id,
        profile.id
      ) as ednevnik_student_id
    from public.student_class_enrollments sce
    left join public.registry_students registry_student
      on registry_student.id = sce.registry_student_id
    left join public.registry_students registry_by_student_id
      on registry_by_student_id.id = sce.student_id
    left join public.user_profiles profile
      on profile.id = sce.student_id
      or profile.auth_user_id = sce.student_id
    where sce.class_id = p_class_id
      and coalesce(sce.ematica_status::text, sce.status::text, 'ACTIVE') = 'ACTIVE'
  loop
    registry_student_id := null;
    candidate_id := null;
    grade_years_synced := 0;
    v_candidate_id := null;
    v_registry_student_id := coalesce(
      v_enrollment.registry_student_id,
      (
        select rs.id
        from public.registry_students rs
        where rs.id = v_enrollment.student_id
        limit 1
      )
    );
    v_ednevnik_student_id := v_enrollment.ednevnik_student_id;

    begin
      if v_registry_student_id is null then
        if v_ednevnik_student_id is null then
          raise exception 'Ucenik nema povezan e-Dnevnik profil.';
        end if;

        v_registry_student_id := public.sync_ednevnik_student_to_ematica(
          v_ednevnik_student_id,
          p_class_id
        );
      elsif v_ednevnik_student_id is not null then
        -- Refresh the existing registry record and bridge columns.
        v_registry_student_id := public.sync_ednevnik_student_to_ematica(
          v_ednevnik_student_id,
          p_class_id
        );
      end if;

      select ac.id into v_candidate_id
      from public.admission_candidates ac
      where ac.track = p_track
        and ac.registry_student_id = v_registry_student_id
        and ac.school_year_id = p_school_year_id
      limit 1;

      if v_candidate_id is null then
        insert into public.admission_candidates (
          track,
          registry_student_id,
          ednevnik_student_id,
          source_school_id,
          source_class_id,
          school_year_id,
          status
        )
        values (
          p_track,
          v_registry_student_id,
          v_ednevnik_student_id,
          v_class.school_id,
          p_class_id,
          p_school_year_id,
          'DRAFT'
        )
        returning id into v_candidate_id;

        result := 'CREATED';
      else
        update public.admission_candidates
        set ednevnik_student_id = coalesce(v_ednevnik_student_id, ednevnik_student_id),
            source_school_id = v_class.school_id,
            source_class_id = p_class_id,
            updated_at = now()
        where id = v_candidate_id;

        result := 'EXISTS';
      end if;

      grade_years_synced := public.sync_admission_candidate_grade_summaries(v_candidate_id);
      registry_student_id := v_registry_student_id;
      candidate_id := v_candidate_id;
    exception when others then
      result := 'ERROR: ' || sqlerrm;
    end;

    return next;
  end loop;
end;
$$;

grant execute on function public.sync_admission_candidate_grade_summaries(uuid) to authenticated;
grant execute on function public.create_class_admission_candidates(
  text,
  public.admissions_track,
  uuid
) to authenticated;

-- Pull eligible students directly from e-Dnevnik class enrollments.
-- Higher-education admissions accept only 4th grade students, except 4.K.
-- Historical grades 1-3 are copied when the candidate is activated.
-- The 4th grade is added automatically when its e-Matica year-end summary arrives.

create table if not exists public.admission_candidate_grade_summaries (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.admission_candidates(id) on delete cascade,
  year_end_summary_id uuid references public.student_year_end_summaries(id) on delete set null,
  registry_student_id uuid not null references public.registry_students(id) on delete cascade,
  class_id text references public.classes(id) on delete set null,
  school_year_id uuid references public.school_years(id) on delete set null,
  grade_level integer not null check (grade_level between 1 and 8),
  final_grade_average numeric(4,2),
  final_success_text text,
  final_grades jsonb not null default '[]'::jsonb,
  source text not null default 'EMATICA',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, grade_level)
);

create index if not exists idx_admission_candidate_grade_summaries_student
  on public.admission_candidate_grade_summaries(registry_student_id, grade_level);

drop trigger if exists set_admission_candidate_grade_summaries_updated_at
  on public.admission_candidate_grade_summaries;
create trigger set_admission_candidate_grade_summaries_updated_at
before update on public.admission_candidate_grade_summaries
for each row execute function public.set_updated_at();

alter table public.admission_candidate_grade_summaries enable row level security;

drop policy if exists "Authenticated users can read admission candidate grades"
  on public.admission_candidate_grade_summaries;
create policy "Authenticated users can read admission candidate grades"
on public.admission_candidate_grade_summaries for select
to authenticated
using (true);

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
  v_count integer := 0;
begin
  select * into v_candidate
  from public.admission_candidates
  where id = p_candidate_id;

  if v_candidate.id is null then
    raise exception 'Kandidat ne postoji: %', p_candidate_id;
  end if;

  -- For grades 1-3, create an e-Matica year-end summary from existing
  -- e-Dnevnik final grades when it has not been pulled before.
  if v_candidate.track = 'HIGHER_EDUCATION' then
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
        )
        and school.education_level = 'SECONDARY'
        and c.grade_level between 1 and 3
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
  end if;

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
      and (
        (
          v_candidate.track = 'HIGHER_EDUCATION'
          and school.education_level = 'SECONDARY'
          and c.grade_level between 1 and 4
        )
        or
        (
          v_candidate.track = 'SECONDARY'
          and school.education_level = 'ELEMENTARY'
          and c.grade_level between 5 and 8
        )
      )
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

create or replace function public.sync_year_end_summary_to_admissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate record;
begin
  for v_candidate in
    select ac.id
    from public.admission_candidates ac
    where ac.registry_student_id = new.registry_student_id
  loop
    perform public.sync_admission_candidate_grade_summaries(v_candidate.id);
  end loop;

  return new;
end;
$$;

drop trigger if exists sync_year_end_summary_to_admissions
  on public.student_year_end_summaries;
create trigger sync_year_end_summary_to_admissions
after insert or update of final_grades, final_grade_average, final_success_text
on public.student_year_end_summaries
for each row execute function public.sync_year_end_summary_to_admissions();

create or replace view public.v_admission_candidate_grade_summaries as
select
  grades.id,
  grades.candidate_id,
  candidate.track,
  grades.registry_student_id,
  concat_ws(' ', student.first_name, student.last_name) as full_name,
  grades.grade_level,
  grades.class_id,
  class_row.name as class_name,
  grades.school_year_id,
  school_year.label as school_year_label,
  grades.final_grade_average,
  grades.final_success_text,
  grades.final_grades,
  grades.source,
  grades.synced_at
from public.admission_candidate_grade_summaries grades
join public.admission_candidates candidate on candidate.id = grades.candidate_id
join public.registry_students student on student.id = grades.registry_student_id
left join public.classes class_row on class_row.id = grades.class_id
left join public.school_years school_year on school_year.id = grades.school_year_id;

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
    select distinct sce.student_id
    from public.student_class_enrollments sce
    where sce.class_id = p_class_id
      and sce.student_id is not null
      and coalesce(sce.ematica_status::text, sce.status::text, 'ACTIVE') = 'ACTIVE'
  loop
    registry_student_id := null;
    candidate_id := null;
    grade_years_synced := 0;

    begin
      v_registry_student_id := public.sync_ednevnik_student_to_ematica(
        v_enrollment.student_id,
        p_class_id
      );

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
          v_enrollment.student_id,
          v_class.school_id,
          p_class_id,
          p_school_year_id,
          'DRAFT'
        )
        returning id into v_candidate_id;

        result := 'CREATED';
      else
        update public.admission_candidates
        set ednevnik_student_id = v_enrollment.student_id,
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

grant select on public.admission_candidate_grade_summaries to authenticated;
grant select on public.v_admission_candidate_grade_summaries to authenticated;
grant execute on function public.sync_admission_candidate_grade_summaries(uuid) to authenticated;
grant execute on function public.create_class_admission_candidates(
  text,
  public.admissions_track,
  uuid
) to authenticated;

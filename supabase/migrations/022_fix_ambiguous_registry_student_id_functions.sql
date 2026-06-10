create or replace function public.pull_class_year_end_to_ematica(p_class_id text)
returns table (
  registry_student_id uuid,
  summary_id uuid,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  for s in
    select sce.registry_student_id as student_registry_id
    from public.student_class_enrollments sce
    where sce.class_id = p_class_id
      and sce.registry_student_id is not null
  loop
    registry_student_id := s.student_registry_id;
    begin
      summary_id := public.pull_ednevnik_year_end_to_ematica(s.student_registry_id, p_class_id);
      result := 'PULLED';
    exception when others then
      summary_id := null;
      result := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;

create or replace function public.create_class_admission_candidates(
  p_class_id text,
  p_track public.admissions_track,
  p_school_year_id uuid default null
)
returns table (
  registry_student_id uuid,
  candidate_id uuid,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_candidate_id uuid;
begin
  for s in
    select
      cur.registry_student_id as student_registry_id,
      cur.ednevnik_student_id,
      cur.school_id,
      cur.class_id,
      cur.school_year_id
    from public.v_ematica_students_current cur
    where cur.class_id = p_class_id
      and cur.student_status = 'ACTIVE'
      and (
        (p_track = 'SECONDARY' and cur.grade_level = 8)
        or
        (p_track = 'HIGHER_EDUCATION' and upper(cur.class_name) in ('4.A', '4.B', '4.C', '4.D', '4.I'))
      )
  loop
    registry_student_id := s.student_registry_id;
    candidate_id := null;
    result := null;
    v_candidate_id := null;

    select ac.id into v_candidate_id
    from public.admission_candidates ac
    where ac.track = p_track
      and ac.registry_student_id = s.student_registry_id
      and ac.school_year_id is not distinct from coalesce(p_school_year_id, s.school_year_id)
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
        s.student_registry_id,
        s.ednevnik_student_id,
        s.school_id,
        s.class_id,
        coalesce(p_school_year_id, s.school_year_id),
        'DRAFT'
      )
      returning id into v_candidate_id;

      result := 'CREATED';
    else
      result := 'EXISTS';
    end if;

    candidate_id := v_candidate_id;
    return next;
  end loop;
end;
$$;

create or replace function public.create_class_admission_applications(
  p_class_id text,
  p_track public.admissions_track,
  p_target_school_id text default null,
  p_target_program_id uuid default null,
  p_school_year_id uuid default null
)
returns table (
  registry_student_id uuid,
  application_id uuid,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_application_id uuid;
begin
  for s in
    select
      cur.registry_student_id as student_registry_id,
      cur.ednevnik_student_id,
      cur.school_id,
      cur.school_year_id
    from public.v_ematica_students_current cur
    where cur.class_id = p_class_id
      and cur.student_status = 'ACTIVE'
      and (
        (p_track = 'SECONDARY' and cur.grade_level = 8)
        or
        (p_track = 'HIGHER_EDUCATION' and upper(cur.class_name) in ('4.A', '4.B', '4.C', '4.D', '4.I'))
      )
  loop
    registry_student_id := s.student_registry_id;
    application_id := null;
    result := null;
    v_application_id := null;

    select aa.id into v_application_id
    from public.admission_applications aa
    where aa.registry_student_id = s.student_registry_id
      and aa.track = p_track
      and aa.target_school_id is not distinct from p_target_school_id
      and aa.target_program_id is not distinct from p_target_program_id
      and aa.school_year_id is not distinct from coalesce(p_school_year_id, s.school_year_id)
    limit 1;

    if v_application_id is not null then
      application_id := v_application_id;
      result := 'EXISTS';
    else
      insert into public.admission_applications (
        track,
        registry_student_id,
        ednevnik_student_id,
        source_school_id,
        target_school_id,
        target_program_id,
        school_year_id,
        status,
        priority
      )
      values (
        p_track,
        s.student_registry_id,
        s.ednevnik_student_id,
        s.school_id,
        p_target_school_id,
        p_target_program_id,
        coalesce(p_school_year_id, s.school_year_id),
        'DRAFT',
        1
      )
      returning id into v_application_id;

      application_id := v_application_id;
      result := 'CREATED';
    end if;

    return next;
  end loop;
end;
$$;

grant execute on function public.pull_class_year_end_to_ematica(text) to authenticated;
grant execute on function public.create_class_admission_candidates(text, public.admissions_track, uuid) to authenticated;
grant execute on function public.create_class_admission_applications(text, public.admissions_track, text, uuid, uuid) to authenticated;

-- Admission access hardening:
-- - secondary admissions: only active 8th grade elementary students
-- - higher admissions: only active final-grade secondary students
-- - differential class 4.K is never eligible for higher admissions

create or replace function public.is_admissions_eligible_class(
  p_track public.admissions_track,
  p_grade_level integer,
  p_class_name text,
  p_program_duration_years integer default null
)
returns boolean
language sql
stable
as $$
  select case
    when p_track = 'SECONDARY' then p_grade_level = 8
    when p_track = 'HIGHER_EDUCATION' then
      upper(coalesce(btrim(p_class_name), '')) <> '4.K'
      and p_grade_level = coalesce(nullif(p_program_duration_years, 0), 4)
    else false
  end;
$$;

create or replace view public.v_ematica_students_current as
with latest_school_enrollment as (
  select distinct on (sse.student_id)
    sse.*
  from public.student_school_enrollments sse
  order by
    sse.student_id,
    case when sse.status = 'ACTIVE' then 0 else 1 end,
    sse.enrolled_on desc,
    sse.created_at desc
),
latest_class_enrollment as (
  select distinct on (sce.registry_student_id)
    sce.registry_student_id,
    sce.student_id as ednevnik_student_id,
    sce.class_id,
    sce.school_year,
    sce.school_year_id,
    sce.program_id,
    sce.ematica_status,
    sce.ednevnik_data_entry_blocked
  from public.student_class_enrollments sce
  where sce.registry_student_id is not null
  order by
    sce.registry_student_id,
    case when sce.ematica_status = 'ACTIVE' then 0 else 1 end,
    sce.school_year desc nulls last
)
select
  rs.id as registry_student_id,
  rs.first_name,
  rs.last_name,
  concat_ws(' ', rs.first_name, rs.last_name) as full_name,
  rs.date_of_birth,
  rs.oib,
  rs.email,
  rs.phone,
  rs.status as student_status,
  rs.ednevnik_student_id,
  rs.ednevnik_synced_at,
  rs.ednevnik_data_entry_blocked,
  lse.id as school_enrollment_id,
  coalesce(lse.school_id, c.school_id) as school_id,
  coalesce(s.name, class_school.name) as school_name,
  coalesce(lse.school_year_id, lce.school_year_id, c.school_year_id) as school_year_id,
  coalesce(sy.label, class_sy.label) as school_year_label,
  coalesce(lse.program_id, lce.program_id, c.program_id) as school_program_id,
  p.name as program_name,
  lse.status as school_enrollment_status,
  lse.enrolled_on,
  lse.exited_on,
  lse.exit_reason,
  lce.class_id,
  c.name as class_name,
  c.grade_level,
  c.section,
  lce.ematica_status as class_enrollment_status,
  coalesce(lce.ednevnik_data_entry_blocked, rs.ednevnik_data_entry_blocked) as data_entry_blocked,
  coalesce(s.education_level, class_school.education_level) as school_level,
  p.duration_years as program_duration_years
from public.registry_students rs
left join latest_school_enrollment lse on lse.student_id = rs.id
left join public.schools s on s.id = lse.school_id
left join public.school_years sy on sy.id = lse.school_year_id
left join latest_class_enrollment lce on lce.registry_student_id = rs.id
left join public.classes c on c.id = lce.class_id
left join public.schools class_school on class_school.id = c.school_id
left join public.school_years class_sy on class_sy.id = coalesce(lce.school_year_id, c.school_year_id)
left join public.programs p on p.id = coalesce(lse.program_id, lce.program_id, c.program_id);

create or replace view public.v_ematica_class_summary as
select
  c.id as class_id,
  c.school_id,
  s.name as school_name,
  c.school_year_id,
  sy.label as school_year_label,
  c.school_year,
  c.name as class_name,
  c.grade_level,
  c.section,
  c.program_id,
  p.name as program_name,
  c.homeroom_teacher_id,
  c.deputy_teacher_id,
  c.deputy_homeroom_teacher_id,
  c.previous_class_id,
  c.next_class_id,
  c.is_graduating_class,
  c.is_active,
  count(sce.id) filter (where coalesce(sce.ematica_status, 'ACTIVE') = 'ACTIVE') as active_student_count,
  count(sce.id) filter (where coalesce(sce.ematica_status, 'ACTIVE') = 'DROPPED_OUT') as dropped_out_student_count,
  count(sce.id) filter (where coalesce(sce.ematica_status, 'ACTIVE') = 'TRANSFERRED') as transferred_student_count,
  count(sce.id) filter (where coalesce(sce.ematica_status, 'ACTIVE') = 'GRADUATED') as graduated_student_count,
  count(sce.id) as total_student_count,
  p.duration_years as program_duration_years
from public.classes c
left join public.schools s on s.id = c.school_id
left join public.school_years sy on sy.id = c.school_year_id
left join public.programs p on p.id = c.program_id
left join public.student_class_enrollments sce on sce.class_id = c.id
group by
  c.id,
  c.school_id,
  s.name,
  c.school_year_id,
  sy.label,
  c.school_year,
  c.name,
  c.grade_level,
  c.section,
  c.program_id,
  p.name,
  c.homeroom_teacher_id,
  c.deputy_teacher_id,
  c.deputy_homeroom_teacher_id,
  c.previous_class_id,
  c.next_class_id,
  c.is_graduating_class,
  c.is_active,
  p.duration_years;

create or replace view public.v_admissions_secondary_eligible as
select *
from public.v_ematica_students_current
where school_level = 'ELEMENTARY'
  and public.is_admissions_eligible_class('SECONDARY', grade_level, class_name, program_duration_years)
  and student_status = 'ACTIVE';

create or replace view public.v_admissions_higher_eligible as
select *
from public.v_ematica_students_current
where school_level = 'SECONDARY'
  and public.is_admissions_eligible_class('HIGHER_EDUCATION', grade_level, class_name, program_duration_years)
  and student_status = 'ACTIVE';

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
        (p_track = 'SECONDARY' and cur.school_level = 'ELEMENTARY')
        or
        (p_track = 'HIGHER_EDUCATION' and cur.school_level = 'SECONDARY')
      )
      and public.is_admissions_eligible_class(p_track, cur.grade_level, cur.class_name, cur.program_duration_years)
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
        (p_track = 'SECONDARY' and cur.school_level = 'ELEMENTARY')
        or
        (p_track = 'HIGHER_EDUCATION' and cur.school_level = 'SECONDARY')
      )
      and public.is_admissions_eligible_class(p_track, cur.grade_level, cur.class_name, cur.program_duration_years)
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

grant select on public.v_ematica_students_current to authenticated;
grant select on public.v_ematica_class_summary to authenticated;
grant select on public.v_admissions_secondary_eligible to authenticated;
grant select on public.v_admissions_higher_eligible to authenticated;
grant execute on function public.is_admissions_eligible_class(public.admissions_track, integer, text, integer) to authenticated;
grant execute on function public.create_class_admission_candidates(text, public.admissions_track, uuid) to authenticated;
grant execute on function public.create_class_admission_applications(text, public.admissions_track, text, uuid, uuid) to authenticated;

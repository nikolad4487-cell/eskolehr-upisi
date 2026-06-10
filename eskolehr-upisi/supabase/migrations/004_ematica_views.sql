-- e-Matica phase 4: application-friendly views.

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
  lse.school_id,
  s.name as school_name,
  lse.school_year_id,
  sy.label as school_year_label,
  lse.program_id as school_program_id,
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
  coalesce(lce.ednevnik_data_entry_blocked, rs.ednevnik_data_entry_blocked) as data_entry_blocked
from public.registry_students rs
left join latest_school_enrollment lse on lse.student_id = rs.id
left join public.schools s on s.id = lse.school_id
left join public.school_years sy on sy.id = lse.school_year_id
left join public.programs p on p.id = lse.program_id
left join latest_class_enrollment lce on lce.registry_student_id = rs.id
left join public.classes c on c.id = lce.class_id;

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
  count(sce.id) as total_student_count
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
  c.is_active;

create or replace view public.v_ematica_dashboard_stats as
select
  (select count(*) from public.schools where coalesce(is_active, true) = true) as active_schools_count,
  (select count(*) from public.programs where coalesce(is_active, true) = true) as active_programs_count,
  (select count(*) from public.registry_students) as total_students_count,
  (select count(*) from public.registry_students where status = 'ACTIVE') as active_students_count,
  (select count(*) from public.registry_students where status = 'DROPPED_OUT') as dropped_out_students_count,
  (select count(*) from public.registry_students where status = 'TRANSFERRED') as transferred_students_count,
  (select count(*) from public.registry_students where status = 'GRADUATED') as graduated_students_count,
  (select count(*) from public.registry_students where ednevnik_student_id is null) as not_linked_to_ednevnik_count,
  (select count(*) from public.registry_students where ednevnik_student_id is not null) as linked_to_ednevnik_count,
  (select count(*) from public.ednevnik_sync_logs where status = 'FAILED') as failed_sync_count,
  now() as generated_at;

create or replace view public.v_ematica_transition_candidates as
select
  c.id as from_class_id,
  c.name as from_class_name,
  c.school_id,
  s.name as school_name,
  c.school_year_id as from_school_year_id,
  sy.label as from_school_year_label,
  public.get_next_class_name(c.name) as suggested_to_class_name,
  c.next_class_id,
  next_c.school_year_id as to_school_year_id,
  next_sy.label as to_school_year_label,
  case
    when public.is_regular_graduation_class(c.name) then 'GRADUATE'
    when public.get_next_class_name(c.name) is not null and c.next_class_id is not null then 'READY'
    when public.get_next_class_name(c.name) is not null then 'TARGET_CLASS_MISSING'
    else 'NO_RULE'
  end as transition_status,
  count(sce.id) filter (where coalesce(sce.ematica_status, 'ACTIVE') = 'ACTIVE') as active_student_count
from public.classes c
left join public.schools s on s.id = c.school_id
left join public.school_years sy on sy.id = c.school_year_id
left join public.classes next_c on next_c.id = c.next_class_id
left join public.school_years next_sy on next_sy.id = next_c.school_year_id
left join public.student_class_enrollments sce on sce.class_id = c.id and sce.registry_student_id is not null
where coalesce(c.is_active, true) = true
group by
  c.id,
  c.name,
  c.school_id,
  s.name,
  c.school_year_id,
  sy.label,
  c.next_class_id,
  next_c.school_year_id,
  next_sy.label;

create or replace view public.v_ematica_sync_status as
with latest_sync as (
  select distinct on (l.student_id)
    l.*
  from public.ednevnik_sync_logs l
  order by l.student_id, l.created_at desc
)
select
  rs.id as registry_student_id,
  rs.first_name,
  rs.last_name,
  concat_ws(' ', rs.first_name, rs.last_name) as full_name,
  rs.status as student_status,
  rs.ednevnik_student_id,
  rs.ednevnik_synced_at,
  rs.ednevnik_data_entry_blocked,
  case
    when rs.ednevnik_student_id is null then 'NOT_LINKED'
    when latest_sync.status = 'FAILED' then 'FAILED'
    when rs.ednevnik_synced_at is null then 'PENDING'
    else 'SYNCED'
  end as sync_state,
  latest_sync.action as last_sync_action,
  latest_sync.status as last_sync_status,
  latest_sync.message as last_sync_message,
  latest_sync.created_at as last_sync_at
from public.registry_students rs
left join latest_sync on latest_sync.student_id = rs.id;

grant select on public.v_ematica_students_current to authenticated;
grant select on public.v_ematica_class_summary to authenticated;
grant select on public.v_ematica_dashboard_stats to authenticated;
grant select on public.v_ematica_transition_candidates to authenticated;
grant select on public.v_ematica_sync_status to authenticated;

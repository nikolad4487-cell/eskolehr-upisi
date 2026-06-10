-- Phase 18: detailed class enrollment management for e-Matica.

alter table public.student_class_enrollments
  add column if not exists enrolled_on date not null default current_date;

alter table public.student_class_enrollments
  add column if not exists exited_on date;

alter table public.student_class_enrollments
  add column if not exists exit_reason text;

alter table public.student_class_enrollments
  add column if not exists updated_at timestamptz not null default now();

alter table public.student_class_enrollments
  add column if not exists created_at timestamptz not null default now();

create or replace view public.v_student_class_enrollments_detailed as
select
  sce.id as class_enrollment_id,
  coalesce(sce.registry_student_id, rs_direct.id, rs_ednevnik.id) as registry_student_id,
  sce.student_id as ednevnik_or_legacy_student_id,
  coalesce(rs_bridge.ednevnik_student_id, rs_direct.ednevnik_student_id, rs_ednevnik.ednevnik_student_id) as ednevnik_student_id,
  concat_ws(' ', coalesce(rs_bridge.first_name, rs_direct.first_name, rs_ednevnik.first_name), coalesce(rs_bridge.last_name, rs_direct.last_name, rs_ednevnik.last_name)) as full_name,
  coalesce(rs_bridge.oib, rs_direct.oib, rs_ednevnik.oib) as oib,
  coalesce(rs_bridge.status, rs_direct.status, rs_ednevnik.status) as student_status,
  sce.class_id,
  c.name as class_name,
  c.school_id,
  s.name as school_name,
  coalesce(sce.school_year_id, c.school_year_id) as school_year_id,
  coalesce(sy.label, sce.school_year, c.school_year) as school_year_label,
  coalesce(sce.program_id, c.program_id) as program_id,
  p.name as program_name,
  coalesce(sce.ematica_status, sce.status::public.enrollment_status, 'ACTIVE'::public.enrollment_status) as enrollment_status,
  sce.enrolled_on,
  sce.exited_on,
  sce.exit_reason,
  sce.ednevnik_data_entry_blocked,
  sce.created_at,
  sce.updated_at
from public.student_class_enrollments sce
left join public.registry_students rs_bridge on rs_bridge.id = sce.registry_student_id
left join public.registry_students rs_direct on rs_direct.id = sce.student_id
left join public.registry_students rs_ednevnik on rs_ednevnik.ednevnik_student_id = sce.student_id
left join public.classes c on c.id = sce.class_id
left join public.schools s on s.id = c.school_id
left join public.school_years sy on sy.id = coalesce(sce.school_year_id, c.school_year_id)
left join public.programs p on p.id = coalesce(sce.program_id, c.program_id);

grant select on public.v_student_class_enrollments_detailed to authenticated;

create or replace function public.update_student_class_enrollment_status(
  p_class_enrollment_id uuid,
  p_status public.enrollment_status,
  p_exit_reason text default null
)
returns public.student_class_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.student_class_enrollments;
begin
  update public.student_class_enrollments
  set ematica_status = p_status,
      status = p_status,
      exited_on = case when p_status = 'ACTIVE' then null else coalesce(exited_on, current_date) end,
      exit_reason = case when p_status = 'ACTIVE' then null else coalesce(p_exit_reason, exit_reason) end,
      ednevnik_data_entry_blocked = (p_status = 'DROPPED_OUT'),
      updated_at = now()
  where id = p_class_enrollment_id
  returning * into v_enrollment;

  if v_enrollment.id is null then
    raise exception 'Upis u razred ne postoji: %', p_class_enrollment_id;
  end if;

  return v_enrollment;
end;
$$;

create or replace function public.delete_student_class_enrollment(
  p_class_enrollment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.student_class_enrollments
  where id = p_class_enrollment_id;

  if not found then
    raise exception 'Upis u razred ne postoji: %', p_class_enrollment_id;
  end if;
end;
$$;

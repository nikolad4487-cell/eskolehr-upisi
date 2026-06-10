-- e-Matica phase 7: readable transfer view for the application.

create or replace view public.v_ematica_transfers_detailed as
select
  t.id as transfer_id,
  t.student_id as registry_student_id,
  rs.first_name,
  rs.last_name,
  concat_ws(' ', rs.first_name, rs.last_name) as full_name,
  rs.oib,
  t.from_school_id,
  from_school.name as from_school_name,
  t.to_school_id,
  to_school.name as to_school_name,
  t.from_school_year_id,
  from_year.label as from_school_year_label,
  t.to_school_year_id,
  to_year.label as to_school_year_label,
  t.from_class_id,
  from_class.name as from_class_name,
  t.to_class_id,
  to_class.name as to_class_name,
  t.from_program_id,
  from_program.name as from_program_name,
  t.to_program_id,
  to_program.name as to_program_name,
  t.status,
  t.reason,
  t.requested_on,
  t.approved_at,
  t.completed_at,
  t.created_at
from public.student_transfers t
join public.registry_students rs on rs.id = t.student_id
left join public.schools from_school on from_school.id = t.from_school_id
left join public.schools to_school on to_school.id = t.to_school_id
left join public.school_years from_year on from_year.id = t.from_school_year_id
left join public.school_years to_year on to_year.id = t.to_school_year_id
left join public.classes from_class on from_class.id = t.from_class_id
left join public.classes to_class on to_class.id = t.to_class_id
left join public.programs from_program on from_program.id = t.from_program_id
left join public.programs to_program on to_program.id = t.to_program_id;

grant select on public.v_ematica_transfers_detailed to authenticated;

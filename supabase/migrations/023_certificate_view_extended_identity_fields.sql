create or replace view public.v_ematica_year_end_summaries as
select
  ys.id as summary_id,
  ys.registry_student_id,
  concat_ws(' ', rs.first_name, rs.last_name) as full_name,
  rs.oib,
  ys.ednevnik_student_id,
  ys.class_id,
  c.name as class_name,
  ys.school_id,
  s.name as school_name,
  ys.school_year_id,
  sy.label as school_year_label,
  ys.status,
  ys.final_grade_average,
  ys.final_success_text,
  ys.pulled_from_ednevnik_at,
  cert.id as certificate_id,
  cert.status as certificate_status,
  cert.certificate_number,
  cert.issued_at,
  ys.final_grades,
  ys.notes,
  cert.payload as certificate_payload,
  s.oib as school_oib,
  rs.date_of_birth,
  rs.city,
  rs.parent_guardian_name
from public.student_year_end_summaries ys
join public.registry_students rs on rs.id = ys.registry_student_id
left join public.classes c on c.id = ys.class_id
left join public.schools s on s.id = ys.school_id
left join public.school_years sy on sy.id = ys.school_year_id
left join public.student_certificates cert on cert.year_end_summary_id = ys.id;

grant select on public.v_ematica_year_end_summaries to authenticated;

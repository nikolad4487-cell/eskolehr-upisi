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
  cert.payload as certificate_payload
from public.student_year_end_summaries ys
join public.registry_students rs on rs.id = ys.registry_student_id
left join public.classes c on c.id = ys.class_id
left join public.schools s on s.id = ys.school_id
left join public.school_years sy on sy.id = ys.school_year_id
left join public.student_certificates cert on cert.year_end_summary_id = ys.id;

grant select on public.v_ematica_year_end_summaries to authenticated;

create or replace function public.update_student_certificate_status(
  p_certificate_id uuid,
  p_status public.certificate_status,
  p_reason text default null
)
returns public.student_certificates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_certificate public.student_certificates;
  v_payload jsonb;
begin
  select coalesce(payload, '{}'::jsonb)
    into v_payload
  from public.student_certificates
  where id = p_certificate_id;

  if v_payload is null then
    raise exception 'Svjedodzba ne postoji: %', p_certificate_id;
  end if;

  if p_status = 'CANCELLED' then
    v_payload := v_payload
      || jsonb_build_object(
        'cancelled_at', now(),
        'cancelled_by', auth.uid(),
        'cancellation_reason', nullif(p_reason, '')
      );
  elsif p_status = 'READY' then
    v_payload := v_payload - 'cancelled_at' - 'cancelled_by' - 'cancellation_reason';
  end if;

  update public.student_certificates
  set
    status = p_status,
    payload = v_payload,
    certificate_number = case
      when p_status in ('DRAFT', 'READY') then null
      else certificate_number
    end,
    issued_at = case
      when p_status in ('DRAFT', 'READY') then null
      else issued_at
    end
  where id = p_certificate_id
  returning * into v_certificate;

  return v_certificate;
end;
$$;

create or replace function public.delete_student_certificate(
  p_certificate_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.certificate_status;
begin
  select status
    into v_status
  from public.student_certificates
  where id = p_certificate_id;

  if v_status is null then
    raise exception 'Svjedodzba ne postoji: %', p_certificate_id;
  end if;

  if v_status = 'ISSUED' then
    raise exception 'Izdanu svjedodzbu prvo storniraj, zatim je mozes obrisati.';
  end if;

  delete from public.student_certificates
  where id = p_certificate_id;
end;
$$;

grant execute on function public.update_student_certificate_status(uuid, public.certificate_status, text) to authenticated;
grant execute on function public.delete_student_certificate(uuid) to authenticated;

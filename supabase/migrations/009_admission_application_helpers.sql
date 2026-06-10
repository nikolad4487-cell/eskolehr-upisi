-- Phase 9: e-Upisi application workflow helpers.

create or replace function public.update_admission_application_status(
  p_application_id uuid,
  p_status public.admission_application_status,
  p_points numeric default null,
  p_note text default null
)
returns public.admission_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.admission_applications;
begin
  update public.admission_applications
  set status = p_status,
      points = coalesce(p_points, points),
      note = coalesce(p_note, note),
      submitted_at = case when p_status = 'SUBMITTED' then coalesce(submitted_at, now()) else submitted_at end,
      verified_at = case when p_status = 'VERIFIED' then coalesce(verified_at, now()) else verified_at end,
      updated_at = now()
  where id = p_application_id
  returning * into v_application;

  if v_application.id is null then
    raise exception 'Prijava ne postoji: %', p_application_id;
  end if;

  return v_application;
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
  v_class record;
  v_application_id uuid;
begin
  select id, school_id, school_year_id
  into v_class
  from public.classes
  where id = p_class_id;

  if v_class.id is null then
    raise exception 'Razred ne postoji: %', p_class_id;
  end if;

  for s in
    select
      sce.registry_student_id,
      sce.student_id as ednevnik_student_id
    from public.student_class_enrollments sce
    join public.registry_students rs on rs.id = sce.registry_student_id
    where sce.class_id = p_class_id
      and coalesce(sce.ematica_status, 'ACTIVE') = 'ACTIVE'
      and rs.status = 'ACTIVE'
      and sce.registry_student_id is not null
  loop
    select aa.id
    into v_application_id
    from public.admission_applications aa
    where aa.registry_student_id = s.registry_student_id
      and aa.track = p_track
      and aa.school_year_id is not distinct from coalesce(p_school_year_id, v_class.school_year_id)
      and aa.target_school_id is not distinct from p_target_school_id
      and aa.target_program_id is not distinct from p_target_program_id
    limit 1;

    registry_student_id := s.registry_student_id;

    if v_application_id is null then
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
        s.registry_student_id,
        s.ednevnik_student_id,
        v_class.school_id,
        p_target_school_id,
        p_target_program_id,
        coalesce(p_school_year_id, v_class.school_year_id),
        'DRAFT',
        1
      )
      returning id into v_application_id;

      application_id := v_application_id;
      result := 'CREATED';
    else
      application_id := v_application_id;
      result := 'EXISTS';
    end if;

    return next;
  end loop;
end;
$$;

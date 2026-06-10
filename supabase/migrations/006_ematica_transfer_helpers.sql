-- e-Matica phase 6: transfer and status helpers used by the frontend.

create or replace function public.transfer_registry_student(
  p_registry_student_id uuid,
  p_to_class_id text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.registry_students;
  v_from_school_id text;
  v_from_school_year_id uuid;
  v_from_class_id text;
  v_from_program_id uuid;
  v_to_class record;
  v_transfer_id uuid;
  v_school_enrollment_id uuid;
begin
  select *
  into v_student
  from public.registry_students
  where id = p_registry_student_id;

  if v_student.id is null then
    raise exception 'e-Matica ucenik ne postoji: %', p_registry_student_id;
  end if;

  select
    c.school_id,
    c.school_year_id,
    c.id,
    c.program_id
  into
    v_from_school_id,
    v_from_school_year_id,
    v_from_class_id,
    v_from_program_id
  from public.student_class_enrollments sce
  join public.classes c on c.id = sce.class_id
  where sce.registry_student_id = p_registry_student_id
    and coalesce(sce.ematica_status, 'ACTIVE') = 'ACTIVE'
  order by c.school_year desc nulls last, sce.created_at desc nulls last
  limit 1;

  select id, school_id, school_year_id, program_id
  into v_to_class
  from public.classes
  where id = p_to_class_id;

  if v_to_class.id is null then
    raise exception 'Ciljni razred ne postoji: %', p_to_class_id;
  end if;

  insert into public.student_transfers (
    student_id,
    from_school_id,
    to_school_id,
    from_school_year_id,
    to_school_year_id,
    from_class_id,
    to_class_id,
    from_program_id,
    to_program_id,
    status,
    reason,
    approved_at,
    completed_at
  )
  values (
    p_registry_student_id,
    v_from_school_id,
    v_to_class.school_id,
    v_from_school_year_id,
    v_to_class.school_year_id,
    v_from_class_id,
    p_to_class_id,
    v_from_program_id,
    v_to_class.program_id,
    'COMPLETED',
    p_reason,
    now(),
    now()
  )
  returning id into v_transfer_id;

  update public.student_school_enrollments
  set status = 'TRANSFERRED',
      exited_on = current_date,
      exit_reason = coalesce(p_reason, 'Premjestaj evidentiran kroz e-Upisi.'),
      updated_at = now()
  where student_id = p_registry_student_id
    and status = 'ACTIVE'
    and school_year_id is distinct from v_to_class.school_year_id;

  update public.student_class_enrollments
  set ematica_status = 'TRANSFERRED',
      ednevnik_data_entry_blocked = false
  where registry_student_id = p_registry_student_id
    and coalesce(ematica_status, 'ACTIVE') = 'ACTIVE'
    and class_id <> p_to_class_id;

  select id
  into v_school_enrollment_id
  from public.student_school_enrollments
  where student_id = p_registry_student_id
    and school_year_id = v_to_class.school_year_id
    and status = 'ACTIVE'
  limit 1;

  if v_school_enrollment_id is null then
    insert into public.student_school_enrollments (
      student_id,
      school_id,
      school_year_id,
      program_id,
      status,
      enrolled_on,
      source_transfer_id
    )
    values (
      p_registry_student_id,
      v_to_class.school_id,
      v_to_class.school_year_id,
      v_to_class.program_id,
      'ACTIVE',
      current_date,
      v_transfer_id
    )
    returning id into v_school_enrollment_id;
  end if;

  update public.registry_students
  set status = 'ACTIVE',
      ednevnik_data_entry_blocked = false,
      updated_at = now()
  where id = p_registry_student_id;

  perform public.sync_registry_student_to_ednevnik_class(
    p_registry_student_id,
    p_to_class_id,
    v_school_enrollment_id
  );

  insert into public.ednevnik_sync_logs (
    student_id,
    school_enrollment_id,
    ednevnik_student_id,
    action,
    status,
    message,
    payload
  )
  values (
    p_registry_student_id,
    v_school_enrollment_id,
    v_student.ednevnik_student_id,
    'UPDATE_STUDENT',
    'SUCCESS',
    'Ucenik je premjesten i sinkroniziran u ciljni razred.',
    jsonb_build_object('transfer_id', v_transfer_id, 'to_class_id', p_to_class_id)
  );

  return v_transfer_id;
end;
$$;

create or replace function public.set_registry_student_status(
  p_registry_student_id uuid,
  p_status public.student_status
)
returns public.registry_students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.registry_students;
begin
  if p_status = 'DROPPED_OUT' then
    return public.mark_registry_student_dropped_out(p_registry_student_id);
  end if;

  update public.registry_students
  set status = p_status,
      ednevnik_data_entry_blocked = false,
      updated_at = now()
  where id = p_registry_student_id
  returning * into v_student;

  if v_student.id is null then
    raise exception 'e-Matica ucenik ne postoji: %', p_registry_student_id;
  end if;

  update public.student_class_enrollments
  set ematica_status = case
      when p_status = 'TRANSFERRED' then 'TRANSFERRED'::public.enrollment_status
      when p_status = 'GRADUATED' then 'GRADUATED'::public.enrollment_status
      else 'ACTIVE'::public.enrollment_status
    end,
    ednevnik_data_entry_blocked = false
  where registry_student_id = p_registry_student_id;

  insert into public.ednevnik_sync_logs (
    student_id,
    ednevnik_student_id,
    action,
    status,
    message,
    payload
  )
  values (
    p_registry_student_id,
    v_student.ednevnik_student_id,
    'UPDATE_STUDENT',
    'SUCCESS',
    'Status ucenika je promijenjen kroz e-Upisi.',
    jsonb_build_object('status', p_status)
  );

  return v_student;
end;
$$;

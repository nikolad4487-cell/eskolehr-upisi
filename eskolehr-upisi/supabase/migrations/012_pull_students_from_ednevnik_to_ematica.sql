-- Phase 12: pull existing e-Dnevnik students into e-Matica without duplicates.

create or replace function public.profile_text_field(p_profile jsonb, variadic p_keys text[])
returns text
language plpgsql
immutable
as $$
declare
  k text;
  v text;
begin
  foreach k in array p_keys loop
    v := nullif(btrim(p_profile ->> k), '');
    if v is not null then
      return v;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.sync_ednevnik_student_to_ematica(
  p_ednevnik_student_id uuid,
  p_class_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile jsonb;
  v_profile_id uuid;
  v_registry_id uuid;
  v_class record;
  v_school_enrollment_id uuid;
  v_first_name text;
  v_last_name text;
  v_full_name text;
  v_email text;
  v_oib text;
  v_phone text;
begin
  select up.id, to_jsonb(up)
  into v_profile_id, v_profile
  from public.user_profiles up
  where up.id = p_ednevnik_student_id
     or up.auth_user_id = p_ednevnik_student_id
  limit 1;

  if v_profile is null then
    raise exception 'e-Dnevnik profil ne postoji: %', p_ednevnik_student_id;
  end if;

  v_email := public.profile_text_field(v_profile, 'email', 'mail');
  v_oib := public.profile_text_field(v_profile, 'oib', 'OIB');
  if v_oib is not null and v_oib !~ '^[0-9]{11}$' then
    v_oib := null;
  end if;

  v_full_name := public.profile_text_field(v_profile, 'full_name', 'display_name', 'name', 'ime_prezime');
  v_first_name := public.profile_text_field(v_profile, 'first_name', 'ime', 'given_name');
  v_last_name := public.profile_text_field(v_profile, 'last_name', 'prezime', 'family_name', 'surname');

  if v_first_name is null and v_full_name is not null then
    v_first_name := split_part(v_full_name, ' ', 1);
  end if;

  if v_last_name is null and v_full_name is not null then
    v_last_name := nullif(btrim(regexp_replace(v_full_name, '^\S+\s*', '')), '');
  end if;

  if v_first_name is null then
    v_first_name := coalesce(split_part(v_email, '@', 1), 'Ucenik');
  end if;

  if v_last_name is null then
    v_last_name := '-';
  end if;

  v_phone := public.profile_text_field(v_profile, 'phone', 'phone_number', 'mobile', 'telefon');

  select rs.id into v_registry_id
  from public.registry_students rs
  where rs.ednevnik_student_id = v_profile_id
  limit 1;

  if v_registry_id is null and v_oib is not null then
    select rs.id into v_registry_id
    from public.registry_students rs
    where rs.oib = v_oib
    limit 1;
  end if;

  if v_registry_id is null and v_email is not null then
    select rs.id into v_registry_id
    from public.registry_students rs
    where lower(rs.email) = lower(v_email)
    limit 1;
  end if;

  if v_registry_id is null then
    insert into public.registry_students (
      first_name,
      last_name,
      oib,
      email,
      phone,
      status,
      ednevnik_student_id,
      ednevnik_synced_at,
      ednevnik_data_entry_blocked
    )
    values (
      v_first_name,
      v_last_name,
      v_oib,
      v_email,
      v_phone,
      'ACTIVE',
      v_profile_id,
      now(),
      false
    )
    returning id into v_registry_id;
  else
    update public.registry_students
    set first_name = coalesce(v_first_name, first_name),
        last_name = coalesce(v_last_name, last_name),
        oib = coalesce(oib, v_oib),
        email = coalesce(email, v_email),
        phone = coalesce(phone, v_phone),
        ednevnik_student_id = v_profile_id,
        ednevnik_synced_at = now(),
        updated_at = now()
    where id = v_registry_id;
  end if;

  if p_class_id is not null then
    select id, school_id, school_year_id, school_year, program_id
    into v_class
    from public.classes
    where id = p_class_id;

    if v_class.id is null then
      raise exception 'Razred ne postoji: %', p_class_id;
    end if;

    select id into v_school_enrollment_id
    from public.student_school_enrollments
    where student_id = v_registry_id
      and school_id = v_class.school_id
      and school_year_id = v_class.school_year_id
      and status = 'ACTIVE'
    limit 1;

    if v_school_enrollment_id is null then
      insert into public.student_school_enrollments (
        student_id,
        school_id,
        school_year_id,
        program_id,
        status
      )
      values (
        v_registry_id,
        v_class.school_id,
        v_class.school_year_id,
        v_class.program_id,
        'ACTIVE'
      )
      returning id into v_school_enrollment_id;
    end if;

    update public.student_class_enrollments
    set registry_student_id = v_registry_id,
        school_enrollment_id = coalesce(school_enrollment_id, v_school_enrollment_id),
        school_year_id = coalesce(school_year_id, v_class.school_year_id),
        program_id = coalesce(program_id, v_class.program_id),
        ematica_status = 'ACTIVE',
        ednevnik_data_entry_blocked = false,
        updated_at = now()
    where (student_id = p_ednevnik_student_id or student_id = v_profile_id)
      and class_id = p_class_id;

    if not exists (
      select 1
      from public.student_class_enrollments
      where (student_id = p_ednevnik_student_id or student_id = v_profile_id)
        and class_id = p_class_id
    ) then
      insert into public.student_class_enrollments (
        student_id,
        registry_student_id,
        school_enrollment_id,
        class_id,
        school_year,
        school_year_id,
        program_id,
        ematica_status,
        ednevnik_data_entry_blocked
      )
      values (
        v_profile_id,
        v_registry_id,
        v_school_enrollment_id,
        p_class_id,
        v_class.school_year,
        v_class.school_year_id,
        v_class.program_id,
        'ACTIVE',
        false
      );
    end if;
  end if;

  insert into public.ednevnik_sync_logs (
    student_id,
    ednevnik_student_id,
    action,
    status,
    message,
    payload
  )
  values (
    v_registry_id,
    v_profile_id,
    'UPDATE_STUDENT',
    'SUCCESS',
    'Ucenik je povucen iz e-Dnevnika u e-Maticu bez dupliciranja.',
    jsonb_build_object('direction', 'EDNEVNIK_TO_EMATICA', 'class_id', p_class_id, 'source_student_id', p_ednevnik_student_id)
  );

  return v_registry_id;
end;
$$;

create or replace function public.sync_ednevnik_class_to_ematica(p_class_id text)
returns table (
  ednevnik_student_id uuid,
  registry_student_id uuid,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  if not exists (select 1 from public.classes where id = p_class_id) then
    raise exception 'Razred ne postoji: %', p_class_id;
  end if;

  for s in
    select distinct sce.student_id
    from public.student_class_enrollments sce
    where sce.class_id = p_class_id
      and sce.student_id is not null
  loop
    ednevnik_student_id := s.student_id;
    begin
      registry_student_id := public.sync_ednevnik_student_to_ematica(s.student_id, p_class_id);
      result := 'SYNCED';
    exception when others then
      registry_student_id := null;
      result := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;

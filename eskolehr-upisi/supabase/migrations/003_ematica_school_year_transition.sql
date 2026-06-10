-- e-Matica phase 3: school-year transition and paid-continuation helpers.

alter table public.school_years add column if not exists created_at timestamptz default now();
alter table public.school_years add column if not exists updated_at timestamptz default now();
alter table public.school_years add column if not exists label text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'school_years'
      and column_name = 'name'
  ) then
    update public.school_years
    set label = coalesce(label, name)
    where label is null;
  end if;
end $$;

create or replace function public.parse_class_grade_level(p_class_name text)
returns integer
language sql
immutable
as $$
  select nullif(split_part(upper(btrim(p_class_name)), '.', 1), '')::integer;
$$;

create or replace function public.parse_class_section(p_class_name text)
returns text
language sql
immutable
as $$
  select nullif(split_part(upper(btrim(p_class_name)), '.', 2), '');
$$;

create or replace function public.create_next_school_year_classes(
  p_from_school_year_id uuid,
  p_to_school_year_id uuid,
  p_school_id text default null
)
returns table (
  from_class_id text,
  to_class_id text,
  from_class_name text,
  to_class_name text,
  action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_to_school_year_label text;
  v_next_name text;
  v_next_class_id text;
begin
  select label
  into v_to_school_year_label
  from public.school_years
  where id = p_to_school_year_id;

  if v_to_school_year_label is null then
    raise exception 'Ciljna skolska godina ne postoji: %', p_to_school_year_id;
  end if;

  for c in
    select *
    from public.classes
    where school_year_id = p_from_school_year_id
      and (p_school_id is null or school_id = p_school_id)
      and coalesce(is_active, true) = true
  loop
    v_next_name := public.get_next_class_name(c.name);

    if v_next_name is null then
      from_class_id := c.id;
      to_class_id := null;
      from_class_name := c.name;
      to_class_name := null;
      action := case
        when public.is_regular_graduation_class(c.name) then 'GRADUATING_CLASS'
        else 'NO_RULE'
      end;
      return next;
      continue;
    end if;

    select id
    into v_next_class_id
    from public.classes
    where school_id = c.school_id
      and school_year_id = p_to_school_year_id
      and upper(name) = upper(v_next_name)
    limit 1;

    if v_next_class_id is null then
      insert into public.classes (
        school_id,
        school_year,
        school_year_id,
        name,
        grade_level,
        section,
        status,
        homeroom_teacher_id,
        deputy_teacher_id,
        deputy_homeroom_teacher_id,
        program_id,
        previous_class_id,
        is_graduating_class,
        is_active
      )
      values (
        c.school_id,
        v_to_school_year_label,
        p_to_school_year_id,
        v_next_name,
        public.parse_class_grade_level(v_next_name),
        public.parse_class_section(v_next_name),
        'ACTIVE',
        c.homeroom_teacher_id,
        c.deputy_teacher_id,
        coalesce(c.deputy_homeroom_teacher_id, c.deputy_teacher_id),
        c.program_id,
        c.id,
        public.is_regular_graduation_class(v_next_name),
        true
      )
      returning id into v_next_class_id;

      action := 'CREATED';
    else
      update public.classes
      set previous_class_id = coalesce(previous_class_id, c.id),
          homeroom_teacher_id = coalesce(homeroom_teacher_id, c.homeroom_teacher_id),
          deputy_teacher_id = coalesce(deputy_teacher_id, c.deputy_teacher_id),
          deputy_homeroom_teacher_id = coalesce(deputy_homeroom_teacher_id, c.deputy_homeroom_teacher_id, c.deputy_teacher_id),
          program_id = coalesce(program_id, c.program_id),
          is_active = true,
          updated_at = now()
      where id = v_next_class_id;

      action := 'REUSED';
    end if;

    update public.classes
    set next_class_id = v_next_class_id,
        updated_at = now()
    where id = c.id;

    from_class_id := c.id;
    to_class_id := v_next_class_id;
    from_class_name := c.name;
    to_class_name := v_next_name;
    return next;
  end loop;
end;
$$;

create or replace function public.promote_school_year_students(
  p_from_school_year_id uuid,
  p_to_school_year_id uuid,
  p_school_id text default null
)
returns table (
  registry_student_id uuid,
  ednevnik_student_id uuid,
  from_class_id text,
  to_class_id text,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  v_to_class_id text;
  v_school_enrollment_id uuid;
begin
  perform public.create_next_school_year_classes(p_from_school_year_id, p_to_school_year_id, p_school_id);

  for e in
    select
      sce.id as class_enrollment_id,
      sce.registry_student_id,
      sce.student_id as ednevnik_student_id,
      sce.source_school_enrollment_id,
      c.id as class_id,
      c.name as class_name,
      c.school_id,
      c.program_id
    from public.student_class_enrollments sce
    join public.classes c on c.id = sce.class_id
    where sce.registry_student_id is not null
      and c.school_year_id = p_from_school_year_id
      and coalesce(sce.ematica_status, 'ACTIVE') = 'ACTIVE'
      and (p_school_id is null or c.school_id = p_school_id)
  loop
    registry_student_id := e.registry_student_id;
    ednevnik_student_id := e.ednevnik_student_id;
    from_class_id := e.class_id;
    to_class_id := null;

    if public.is_regular_graduation_class(e.class_name) then
      update public.registry_students
      set status = 'GRADUATED',
          ednevnik_data_entry_blocked = false,
          updated_at = now()
      where id = e.registry_student_id;

      update public.student_school_enrollments
      set status = 'GRADUATED',
          exited_on = current_date,
          exit_reason = coalesce(exit_reason, 'Zavrsio/la skolovanje pri prijelazu skolske godine.'),
          updated_at = now()
      where student_id = e.registry_student_id
        and school_year_id = p_from_school_year_id
        and status = 'ACTIVE';

      update public.student_class_enrollments
      set ematica_status = 'GRADUATED',
          ednevnik_data_entry_blocked = false
      where id = e.class_enrollment_id;

      insert into public.ednevnik_sync_logs (
        student_id,
        class_enrollment_id,
        ednevnik_student_id,
        action,
        status,
        message,
        payload
      )
      values (
        e.registry_student_id,
        e.class_enrollment_id,
        e.ednevnik_student_id,
        'UPDATE_STUDENT',
        'SUCCESS',
        'Ucenik je oznacen kao zavrsio skolovanje pri prijelazu skolske godine.',
        jsonb_build_object('from_class_id', e.class_id, 'from_class_name', e.class_name)
      );

      result := 'GRADUATED';
      return next;
      continue;
    end if;

    select c2.id
    into v_to_class_id
    from public.classes c1
    join public.classes c2 on c2.id = c1.next_class_id
    where c1.id = e.class_id
      and c2.school_year_id = p_to_school_year_id
    limit 1;

    if v_to_class_id is null then
      result := 'NO_TARGET_CLASS';
      return next;
      continue;
    end if;

    select id
    into v_school_enrollment_id
    from public.student_school_enrollments
    where student_id = e.registry_student_id
      and school_year_id = p_to_school_year_id
      and status = 'ACTIVE'
    limit 1;

    if v_school_enrollment_id is null then
      insert into public.student_school_enrollments (
        student_id,
        school_id,
        school_year_id,
        program_id,
        status,
        enrolled_on
      )
      values (
        e.registry_student_id,
        e.school_id,
        p_to_school_year_id,
        e.program_id,
        'ACTIVE',
        current_date
      )
      returning id into v_school_enrollment_id;
    end if;

    perform public.sync_registry_student_to_ednevnik_class(
      e.registry_student_id,
      v_to_class_id,
      v_school_enrollment_id
    );

    update public.registry_students
    set status = 'ACTIVE',
        ednevnik_data_entry_blocked = false,
        updated_at = now()
    where id = e.registry_student_id;

    to_class_id := v_to_class_id;
    result := 'PROMOTED';
    return next;
  end loop;
end;
$$;

create or replace function public.continue_paid_education(
  p_registry_student_id uuid,
  p_to_class_id text,
  p_school_enrollment_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_class_name text;
  v_to_class_name text;
  v_school_enrollment_id uuid := p_school_enrollment_id;
  v_enrollment_id uuid;
begin
  select c.name
  into v_last_class_name
  from public.student_class_enrollments sce
  join public.classes c on c.id = sce.class_id
  where sce.registry_student_id = p_registry_student_id
    and upper(c.name) in ('3.A', '3.B', '3.C')
  order by c.school_year desc nulls last, sce.created_at desc nulls last
  limit 1;

  if v_last_class_name is null then
    raise exception 'Placeni nastavak je dozvoljen samo ucenicima iz 3.A, 3.B ili 3.C.';
  end if;

  select name
  into v_to_class_name
  from public.classes
  where id = p_to_class_id;

  if upper(coalesce(v_to_class_name, '')) not in ('4.A', '4.B', '4.C', '4.K') then
    raise exception 'Ciljni razred za placeni nastavak mora biti 4.A, 4.B, 4.C ili 4.K.';
  end if;

  if v_school_enrollment_id is null then
    select sse.id
    into v_school_enrollment_id
    from public.student_school_enrollments sse
    join public.classes c on c.id = p_to_class_id
    where sse.student_id = p_registry_student_id
      and sse.school_year_id = c.school_year_id
      and sse.status = 'ACTIVE'
    limit 1;

    if v_school_enrollment_id is null then
      insert into public.student_school_enrollments (
        student_id,
        school_id,
        school_year_id,
        program_id,
        status,
        enrolled_on
      )
      select
        p_registry_student_id,
        c.school_id,
        c.school_year_id,
        c.program_id,
        'ACTIVE',
        current_date
      from public.classes c
      where c.id = p_to_class_id
      returning id into v_school_enrollment_id;
    end if;
  end if;

  update public.registry_students
  set status = 'ACTIVE',
      ednevnik_data_entry_blocked = false,
      updated_at = now()
  where id = p_registry_student_id;

  v_enrollment_id := public.sync_registry_student_to_ednevnik_class(
    p_registry_student_id,
    p_to_class_id,
    v_school_enrollment_id
  );

  insert into public.ednevnik_sync_logs (
    student_id,
    school_enrollment_id,
    class_enrollment_id,
    action,
    status,
    message,
    payload
  )
  values (
    p_registry_student_id,
    v_school_enrollment_id,
    v_enrollment_id,
    'UPDATE_STUDENT',
    'SUCCESS',
    'Ucenik je rucno prebacen u placeni nastavak obrazovanja.',
    jsonb_build_object('from_class_name', v_last_class_name, 'to_class_id', p_to_class_id, 'to_class_name', v_to_class_name)
  );

  return v_enrollment_id;
end;
$$;

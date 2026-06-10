-- e-Matica phase 2: safe bridge to the existing e-Dnevnik schema.
-- This migration assumes e-Dnevnik stores students in public.user_profiles
-- and active class membership in public.student_class_enrollments.

alter table public.registry_students
  add column if not exists ednevnik_student_id uuid;

alter table public.registry_students
  add column if not exists ednevnik_synced_at timestamptz;

alter table public.registry_students
  add column if not exists ednevnik_data_entry_blocked boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'registry_students_ednevnik_student_id_fkey'
  ) then
    alter table public.registry_students
      add constraint registry_students_ednevnik_student_id_fkey
      foreign key (ednevnik_student_id)
      references public.user_profiles(id)
      on delete set null;
  end if;
end $$;

alter table public.student_class_enrollments
  add column if not exists registry_student_id uuid references public.registry_students(id) on delete set null;

alter table public.student_class_enrollments
  add column if not exists source_school_enrollment_id uuid references public.student_school_enrollments(id) on delete set null;

alter table public.student_class_enrollments
  add column if not exists ematica_status public.enrollment_status not null default 'ACTIVE';

alter table public.student_class_enrollments
  add column if not exists ednevnik_data_entry_blocked boolean not null default false;

create index if not exists idx_student_class_enrollments_registry_student_id
  on public.student_class_enrollments(registry_student_id);

create index if not exists idx_student_class_enrollments_ematica_status
  on public.student_class_enrollments(ematica_status);

create unique index if not exists uq_student_class_enrollments_registry_active_year
  on public.student_class_enrollments(registry_student_id, school_year_id)
  where registry_student_id is not null and ematica_status = 'ACTIVE';

create or replace function public.is_ednevnik_student_blocked(p_student_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.registry_students rs
    where rs.ednevnik_student_id = p_student_id
      and (
        rs.status = 'DROPPED_OUT'
        or rs.ednevnik_data_entry_blocked = true
      )
  );
$$;

create or replace function public.prevent_blocked_ednevnik_student_write()
returns trigger
language plpgsql
as $$
begin
  if new.student_id is not null and public.is_ednevnik_student_blocked(new.student_id) then
    raise exception 'Ucenik je ispisan ili blokiran u e-Matici. Unos podataka u e-Dnevnik nije dozvoljen.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'grades',
    'final_grades',
    'student_notes',
    'student_overall_notes',
    'exams'
  ]
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and column_name = 'student_id'
    ) then
      execute format('drop trigger if exists prevent_blocked_ednevnik_student_write on public.%I', target_table);
      execute format(
        'create trigger prevent_blocked_ednevnik_student_write
         before insert or update on public.%I
         for each row execute function public.prevent_blocked_ednevnik_student_write()',
        target_table
      );
    end if;
  end loop;
end $$;

create or replace function public.link_registry_student_to_ednevnik(
  p_registry_student_id uuid,
  p_ednevnik_student_id uuid
)
returns public.registry_students
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_student public.registry_students;
begin
  if not exists (select 1 from public.user_profiles where id = p_ednevnik_student_id) then
    raise exception 'e-Dnevnik user_profiles zapis ne postoji: %', p_ednevnik_student_id;
  end if;

  if exists (
    select 1
    from public.registry_students
    where ednevnik_student_id = p_ednevnik_student_id
      and id <> p_registry_student_id
  ) then
    raise exception 'e-Dnevnik ucenik je vec povezan s drugim e-Matica ucenikom: %', p_ednevnik_student_id;
  end if;

  update public.registry_students
  set ednevnik_student_id = p_ednevnik_student_id,
      ednevnik_synced_at = now(),
      ednevnik_data_entry_blocked = (status = 'DROPPED_OUT'),
      updated_at = now()
  where id = p_registry_student_id
  returning * into linked_student;

  if linked_student.id is null then
    raise exception 'e-Matica ucenik ne postoji: %', p_registry_student_id;
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
    p_registry_student_id,
    p_ednevnik_student_id,
    'LINK_STUDENT',
    'SUCCESS',
    'Ucenik je povezan s postojecim e-Dnevnik zapisom.',
    jsonb_build_object('registry_student_id', p_registry_student_id, 'ednevnik_student_id', p_ednevnik_student_id)
  );

  return linked_student;
end;
$$;

create or replace function public.sync_registry_student_to_ednevnik_class(
  p_registry_student_id uuid,
  p_class_id text,
  p_school_enrollment_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ednevnik_student_id uuid;
  v_registry_status public.student_status;
  v_class record;
  v_enrollment_id uuid;
begin
  select ednevnik_student_id, status
  into v_ednevnik_student_id, v_registry_status
  from public.registry_students
  where id = p_registry_student_id;

  if v_ednevnik_student_id is null then
    raise exception 'Ucenik prvo mora biti povezan s e-Dnevnik user_profiles zapisom.';
  end if;

  select id, school_year, school_year_id, program_id
  into v_class
  from public.classes
  where id = p_class_id;

  if v_class.id is null then
    raise exception 'Razred ne postoji: %', p_class_id;
  end if;

  select id
  into v_enrollment_id
  from public.student_class_enrollments
  where student_id = v_ednevnik_student_id
    and class_id = p_class_id
    and (
      school_year_id = v_class.school_year_id
      or school_year = v_class.school_year
    )
  limit 1;

  if v_enrollment_id is null then
    insert into public.student_class_enrollments (
      student_id,
      class_id,
      school_year,
      school_year_id,
      program_id,
      registry_student_id,
      source_school_enrollment_id,
      ematica_status,
      ednevnik_data_entry_blocked
    )
    values (
      v_ednevnik_student_id,
      p_class_id,
      v_class.school_year,
      v_class.school_year_id,
      v_class.program_id,
      p_registry_student_id,
      p_school_enrollment_id,
      case
        when v_registry_status = 'DROPPED_OUT' then 'DROPPED_OUT'::public.enrollment_status
        when v_registry_status = 'TRANSFERRED' then 'TRANSFERRED'::public.enrollment_status
        when v_registry_status = 'GRADUATED' then 'GRADUATED'::public.enrollment_status
        else 'ACTIVE'::public.enrollment_status
      end,
      v_registry_status = 'DROPPED_OUT'
    )
    returning id into v_enrollment_id;
  else
    update public.student_class_enrollments
    set registry_student_id = p_registry_student_id,
        source_school_enrollment_id = coalesce(p_school_enrollment_id, source_school_enrollment_id),
        ematica_status = case
          when v_registry_status = 'DROPPED_OUT' then 'DROPPED_OUT'::public.enrollment_status
          when v_registry_status = 'TRANSFERRED' then 'TRANSFERRED'::public.enrollment_status
          when v_registry_status = 'GRADUATED' then 'GRADUATED'::public.enrollment_status
          else 'ACTIVE'::public.enrollment_status
        end,
        ednevnik_data_entry_blocked = (v_registry_status = 'DROPPED_OUT')
    where id = v_enrollment_id;
  end if;

  update public.registry_students
  set ednevnik_synced_at = now(),
      ednevnik_data_entry_blocked = (v_registry_status = 'DROPPED_OUT'),
      updated_at = now()
  where id = p_registry_student_id;

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
    p_school_enrollment_id,
    v_ednevnik_student_id,
    'UPDATE_STUDENT',
    'SUCCESS',
    'Ucenik je sinkroniziran u e-Dnevnik razred bez dupliciranja.',
    jsonb_build_object('class_id', p_class_id, 'student_class_enrollment_id', v_enrollment_id)
  );

  return v_enrollment_id;
end;
$$;

create or replace function public.mark_registry_student_dropped_out(
  p_registry_student_id uuid,
  p_exit_reason text default null,
  p_exited_on date default current_date
)
returns public.registry_students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.registry_students;
begin
  update public.registry_students
  set status = 'DROPPED_OUT',
      ednevnik_data_entry_blocked = true,
      updated_at = now()
  where id = p_registry_student_id
  returning * into v_student;

  if v_student.id is null then
    raise exception 'e-Matica ucenik ne postoji: %', p_registry_student_id;
  end if;

  update public.student_school_enrollments
  set status = 'DROPPED_OUT',
      exited_on = p_exited_on,
      exit_reason = coalesce(p_exit_reason, exit_reason),
      updated_at = now()
  where student_id = p_registry_student_id
    and status = 'ACTIVE';

  update public.student_class_enrollments
  set ematica_status = 'DROPPED_OUT',
      ednevnik_data_entry_blocked = true
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
    'MARK_DROPPED_OUT',
    'SUCCESS',
    'Ucenik je oznacen kao ispisan i blokiran za unos e-Dnevnik podataka.',
    jsonb_build_object('exit_reason', p_exit_reason, 'exited_on', p_exited_on)
  );

  return v_student;
end;
$$;

create or replace function public.get_next_class_name(p_current_class_name text)
returns text
language plpgsql
immutable
as $$
declare
  v_name text := upper(btrim(p_current_class_name));
begin
  return case
    when v_name in ('1.A', '1.B', '1.C', '1.D') then replace(v_name, '1.', '2.')
    when v_name in ('2.A', '2.B', '2.C', '2.D') then replace(v_name, '2.', '3.')
    when v_name = '3.D' then '4.D'
    when v_name = '4.K' then '4.I'
    else null
  end;
end;
$$;

create or replace function public.is_regular_graduation_class(p_class_name text)
returns boolean
language sql
immutable
as $$
  select upper(btrim(p_class_name)) in ('3.A', '3.B', '3.C');
$$;

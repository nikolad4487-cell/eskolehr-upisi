-- e-Matica phase 1 schema
-- Paste into Supabase SQL Editor and run as a single migration.

create extension if not exists pgcrypto;

do $$
begin
  create type public.student_status as enum (
    'ACTIVE',
    'DROPPED_OUT',
    'TRANSFERRED',
    'GRADUATED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.enrollment_status as enum (
    'ACTIVE',
    'DROPPED_OUT',
    'TRANSFERRED',
    'GRADUATED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.transfer_status as enum (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'COMPLETED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.ednevnik_sync_action as enum (
    'CREATE_STUDENT',
    'LINK_STUDENT',
    'UPDATE_STUDENT',
    'MARK_DROPPED_OUT',
    'BLOCK_DATA_ENTRY',
    'UNBLOCK_DATA_ENTRY'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.ednevnik_sync_status as enum (
    'PENDING',
    'SUCCESS',
    'FAILED'
  );
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.schools (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  code text,
  oib text,
  address text,
  city text,
  postal_code text,
  country text not null default 'Hrvatska',
  phone text,
  email text,
  website text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  unique (code),
  unique (oib)
);

create table if not exists public.school_years (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint school_years_valid_dates check (starts_on < ends_on),
  unique (label)
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id) on delete cascade,
  name text not null,
  code text,
  duration_years integer not null default 3,
  is_paid_continuation boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint programs_duration_valid check (duration_years between 1 and 5),
  unique (school_id, code),
  unique (school_id, name)
);

create table if not exists public.registry_students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  oib text,
  email text,
  phone text,
  address text,
  city text,
  postal_code text,
  parent_guardian_name text,
  parent_guardian_email text,
  parent_guardian_phone text,
  status public.student_status not null default 'ACTIVE',
  ednevnik_student_id uuid,
  ednevnik_synced_at timestamptz,
  ednevnik_data_entry_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint registry_students_oib_format check (oib is null or oib ~ '^[0-9]{11}$'),
  unique (oib)
);

create table if not exists public.student_school_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.registry_students(id) on delete cascade,
  school_id text not null references public.schools(id) on delete restrict,
  school_year_id uuid not null references public.school_years(id) on delete restrict,
  program_id uuid references public.programs(id) on delete restrict,
  status public.enrollment_status not null default 'ACTIVE',
  enrolled_on date not null default current_date,
  exited_on date,
  exit_reason text,
  source_transfer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint student_school_enrollments_exit_dates check (exited_on is null or exited_on >= enrolled_on)
);

create table if not exists public.classes (
  id text primary key default gen_random_uuid()::text,
  school_id text not null references public.schools(id) on delete cascade,
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  program_id uuid references public.programs(id) on delete set null,
  grade_level integer not null,
  section text not null,
  name text generated always as (grade_level::text || '.' || upper(section)) stored,
  homeroom_teacher_id uuid references auth.users(id) on delete set null,
  deputy_homeroom_teacher_id uuid references auth.users(id) on delete set null,
  previous_class_id text references public.classes(id) on delete set null,
  next_class_id text references public.classes(id) on delete set null,
  is_graduating_class boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint classes_grade_level_valid check (grade_level between 1 and 5),
  constraint classes_section_not_blank check (btrim(section) <> ''),
  unique (school_id, school_year_id, name)
);

create table if not exists public.student_class_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.registry_students(id) on delete cascade,
  school_enrollment_id uuid not null references public.student_school_enrollments(id) on delete cascade,
  class_id text not null references public.classes(id) on delete restrict,
  school_year_id uuid not null references public.school_years(id) on delete restrict,
  status public.enrollment_status not null default 'ACTIVE',
  enrolled_on date not null default current_date,
  exited_on date,
  exit_reason text,
  promoted_from_class_enrollment_id uuid references public.student_class_enrollments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint student_class_enrollments_exit_dates check (exited_on is null or exited_on >= enrolled_on)
);

create table if not exists public.student_transfers (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.registry_students(id) on delete cascade,
  from_school_id text references public.schools(id) on delete set null,
  to_school_id text references public.schools(id) on delete set null,
  from_school_year_id uuid references public.school_years(id) on delete set null,
  to_school_year_id uuid references public.school_years(id) on delete set null,
  from_class_id text references public.classes(id) on delete set null,
  to_class_id text references public.classes(id) on delete set null,
  from_program_id uuid references public.programs(id) on delete set null,
  to_program_id uuid references public.programs(id) on delete set null,
  status public.transfer_status not null default 'PENDING',
  reason text,
  requested_on date not null default current_date,
  approved_at timestamptz,
  completed_at timestamptz,
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  constraint student_transfers_has_target check (to_school_id is not null or to_class_id is not null or to_program_id is not null),
  constraint student_transfers_not_same_school check (from_school_id is null or to_school_id is null or from_school_id <> to_school_id)
);

alter table public.schools add column if not exists code text;
alter table public.schools add column if not exists oib text;
alter table public.schools add column if not exists address text;
alter table public.schools add column if not exists city text;
alter table public.schools add column if not exists postal_code text;
alter table public.schools add column if not exists country text not null default 'Hrvatska';
alter table public.schools add column if not exists phone text;
alter table public.schools add column if not exists email text;
alter table public.schools add column if not exists website text;
alter table public.schools add column if not exists is_active boolean not null default true;
alter table public.schools add column if not exists created_at timestamptz not null default now();
alter table public.schools add column if not exists updated_at timestamptz not null default now();
alter table public.schools add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;

alter table public.programs add column if not exists code text;
alter table public.programs add column if not exists duration_years integer not null default 3;
alter table public.programs add column if not exists is_paid_continuation boolean not null default false;
alter table public.programs add column if not exists is_active boolean not null default true;
alter table public.programs add column if not exists created_at timestamptz not null default now();
alter table public.programs add column if not exists updated_at timestamptz not null default now();
alter table public.programs add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;

alter table public.classes add column if not exists school_year_id uuid references public.school_years(id) on delete cascade;
alter table public.classes add column if not exists program_id uuid references public.programs(id) on delete set null;
alter table public.classes add column if not exists grade_level integer;
alter table public.classes add column if not exists section text;
alter table public.classes add column if not exists name text;
alter table public.classes add column if not exists homeroom_teacher_id uuid references auth.users(id) on delete set null;
alter table public.classes add column if not exists deputy_homeroom_teacher_id uuid references auth.users(id) on delete set null;
alter table public.classes add column if not exists previous_class_id text references public.classes(id) on delete set null;
alter table public.classes add column if not exists next_class_id text references public.classes(id) on delete set null;
alter table public.classes add column if not exists is_graduating_class boolean not null default false;
alter table public.classes add column if not exists is_active boolean not null default true;
alter table public.classes add column if not exists created_at timestamptz not null default now();
alter table public.classes add column if not exists updated_at timestamptz not null default now();
alter table public.classes add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_school_enrollments_source_transfer_fk'
  ) then
    alter table public.student_school_enrollments
      add constraint student_school_enrollments_source_transfer_fk
      foreign key (source_transfer_id)
      references public.student_transfers(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.ednevnik_sync_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.registry_students(id) on delete cascade,
  school_enrollment_id uuid references public.student_school_enrollments(id) on delete set null,
  class_enrollment_id uuid references public.student_class_enrollments(id) on delete set null,
  ednevnik_student_id uuid,
  action public.ednevnik_sync_action not null,
  status public.ednevnik_sync_status not null default 'PENDING',
  message text,
  payload jsonb not null default '{}'::jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);

create index if not exists idx_programs_school_id on public.programs(school_id);
create index if not exists idx_registry_students_name on public.registry_students(last_name, first_name);
create index if not exists idx_registry_students_status on public.registry_students(status);
create index if not exists idx_registry_students_ednevnik_student_id on public.registry_students(ednevnik_student_id);
create index if not exists idx_school_enrollments_student_id on public.student_school_enrollments(student_id);
create index if not exists idx_school_enrollments_school_year_id on public.student_school_enrollments(school_year_id);
create index if not exists idx_school_enrollments_status on public.student_school_enrollments(status);
create index if not exists idx_classes_school_year_id on public.classes(school_year_id);
create index if not exists idx_classes_teacher_ids on public.classes(homeroom_teacher_id, deputy_homeroom_teacher_id);
create index if not exists idx_class_enrollments_student_id on public.student_class_enrollments(student_id);
create index if not exists idx_class_enrollments_class_id on public.student_class_enrollments(class_id);
create index if not exists idx_class_enrollments_status on public.student_class_enrollments(status);
create index if not exists idx_transfers_student_id on public.student_transfers(student_id);
create index if not exists idx_transfers_status on public.student_transfers(status);
create index if not exists idx_sync_logs_student_id on public.ednevnik_sync_logs(student_id);
create index if not exists idx_sync_logs_status on public.ednevnik_sync_logs(status);

create unique index if not exists uq_student_active_school_year_enrollment
  on public.student_school_enrollments(student_id, school_year_id)
  where status = 'ACTIVE';

create unique index if not exists uq_student_active_class_year_enrollment
  on public.student_class_enrollments(student_id, school_year_id)
  where status = 'ACTIVE';

create unique index if not exists uq_registry_students_ednevnik_student_id
  on public.registry_students(ednevnik_student_id)
  where ednevnik_student_id is not null;

drop trigger if exists set_schools_updated_at on public.schools;
create trigger set_schools_updated_at
before update on public.schools
for each row execute function public.set_updated_at();

drop trigger if exists set_school_years_updated_at on public.school_years;
create trigger set_school_years_updated_at
before update on public.school_years
for each row execute function public.set_updated_at();

drop trigger if exists set_programs_updated_at on public.programs;
create trigger set_programs_updated_at
before update on public.programs
for each row execute function public.set_updated_at();

drop trigger if exists set_registry_students_updated_at on public.registry_students;
create trigger set_registry_students_updated_at
before update on public.registry_students
for each row execute function public.set_updated_at();

drop trigger if exists set_student_school_enrollments_updated_at on public.student_school_enrollments;
create trigger set_student_school_enrollments_updated_at
before update on public.student_school_enrollments
for each row execute function public.set_updated_at();

drop trigger if exists set_classes_updated_at on public.classes;
create trigger set_classes_updated_at
before update on public.classes
for each row execute function public.set_updated_at();

drop trigger if exists set_student_class_enrollments_updated_at on public.student_class_enrollments;
create trigger set_student_class_enrollments_updated_at
before update on public.student_class_enrollments
for each row execute function public.set_updated_at();

drop trigger if exists set_student_transfers_updated_at on public.student_transfers;
create trigger set_student_transfers_updated_at
before update on public.student_transfers
for each row execute function public.set_updated_at();

alter table public.schools enable row level security;
alter table public.school_years enable row level security;
alter table public.programs enable row level security;
alter table public.registry_students enable row level security;
alter table public.student_school_enrollments enable row level security;
alter table public.classes enable row level security;
alter table public.student_class_enrollments enable row level security;
alter table public.student_transfers enable row level security;
alter table public.ednevnik_sync_logs enable row level security;

drop policy if exists "Authenticated users can read schools" on public.schools;
create policy "Authenticated users can read schools"
on public.schools for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage schools" on public.schools;
create policy "Authenticated users can manage schools"
on public.schools for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read school years" on public.school_years;
create policy "Authenticated users can read school years"
on public.school_years for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage school years" on public.school_years;
create policy "Authenticated users can manage school years"
on public.school_years for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read programs" on public.programs;
create policy "Authenticated users can read programs"
on public.programs for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage programs" on public.programs;
create policy "Authenticated users can manage programs"
on public.programs for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read registry students" on public.registry_students;
create policy "Authenticated users can read registry students"
on public.registry_students for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage registry students" on public.registry_students;
create policy "Authenticated users can manage registry students"
on public.registry_students for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read school enrollments" on public.student_school_enrollments;
create policy "Authenticated users can read school enrollments"
on public.student_school_enrollments for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage school enrollments" on public.student_school_enrollments;
create policy "Authenticated users can manage school enrollments"
on public.student_school_enrollments for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read classes" on public.classes;
create policy "Authenticated users can read classes"
on public.classes for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage classes" on public.classes;
create policy "Authenticated users can manage classes"
on public.classes for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read class enrollments" on public.student_class_enrollments;
create policy "Authenticated users can read class enrollments"
on public.student_class_enrollments for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage class enrollments" on public.student_class_enrollments;
create policy "Authenticated users can manage class enrollments"
on public.student_class_enrollments for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read student transfers" on public.student_transfers;
create policy "Authenticated users can read student transfers"
on public.student_transfers for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage student transfers" on public.student_transfers;
create policy "Authenticated users can manage student transfers"
on public.student_transfers for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can read ednevnik sync logs" on public.ednevnik_sync_logs;
create policy "Authenticated users can read ednevnik sync logs"
on public.ednevnik_sync_logs for select
to authenticated
using (true);

drop policy if exists "Authenticated users can create ednevnik sync logs" on public.ednevnik_sync_logs;
create policy "Authenticated users can create ednevnik sync logs"
on public.ednevnik_sync_logs for insert
to authenticated
with check (true);

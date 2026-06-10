-- Phase 8: access context and e-Upisi route foundations.

do $$
begin
  create type public.school_education_level as enum (
    'ELEMENTARY',
    'SECONDARY',
    'HIGHER',
    'OTHER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.admissions_track as enum (
    'SECONDARY',
    'HIGHER_EDUCATION'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.admission_application_status as enum (
    'DRAFT',
    'SUBMITTED',
    'VERIFIED',
    'RETURNED',
    'ACCEPTED',
    'REJECTED',
    'WITHDRAWN'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.schools
  add column if not exists education_level public.school_education_level not null default 'SECONDARY';

alter table public.user_profiles
  add column if not exists active_school_id text references public.schools(id) on delete set null;

alter table public.user_profiles
  add column if not exists access_role text;

create table if not exists public.admission_applications (
  id uuid primary key default gen_random_uuid(),
  track public.admissions_track not null,
  registry_student_id uuid references public.registry_students(id) on delete set null,
  ednevnik_student_id uuid references public.user_profiles(id) on delete set null,
  source_school_id text references public.schools(id) on delete set null,
  target_school_id text references public.schools(id) on delete set null,
  target_program_id uuid references public.programs(id) on delete set null,
  school_year_id uuid references public.school_years(id) on delete set null,
  status public.admission_application_status not null default 'DRAFT',
  priority integer,
  points numeric(8,2),
  note text,
  submitted_at timestamptz,
  verified_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_admission_applications_track
  on public.admission_applications(track);

create index if not exists idx_admission_applications_student
  on public.admission_applications(registry_student_id, ednevnik_student_id);

create index if not exists idx_admission_applications_source_school
  on public.admission_applications(source_school_id);

drop trigger if exists set_admission_applications_updated_at on public.admission_applications;
create trigger set_admission_applications_updated_at
before update on public.admission_applications
for each row execute function public.set_updated_at();

alter table public.admission_applications enable row level security;

drop policy if exists "Authenticated users can read admission applications" on public.admission_applications;
create policy "Authenticated users can read admission applications"
on public.admission_applications for select
to authenticated
using (true);

drop policy if exists "Authenticated users can manage admission applications" on public.admission_applications;
create policy "Authenticated users can manage admission applications"
on public.admission_applications for all
to authenticated
using (true)
with check (true);

create or replace view public.v_ematica_user_access as
select
  up.id as profile_id,
  up.auth_user_id,
  up.email,
  up.access_role,
  up.active_school_id,
  s.name as active_school_name,
  s.education_level as active_school_level,
  exists (
    select 1
    from public.classes c
    where c.homeroom_teacher_id = up.id
       or c.deputy_teacher_id = up.id
       or c.deputy_homeroom_teacher_id = up.id
  ) as is_homeroom_teacher,
  (
    lower(coalesce(up.access_role, '')) in ('admin', 'administrator', 'ravnatelj', 'strucna_sluzba')
  ) as is_admin,
  (
    lower(coalesce(up.access_role, '')) in ('student', 'ucenik')
  ) as is_student,
  (
    lower(coalesce(up.access_role, '')) in ('teacher', 'nastavnik', 'professor')
  ) as is_teacher
from public.user_profiles up
left join public.schools s on s.id = up.active_school_id;

create or replace view public.v_admission_applications_detailed as
select
  aa.id,
  aa.track,
  aa.status,
  aa.priority,
  aa.points,
  aa.note,
  aa.submitted_at,
  aa.verified_at,
  aa.created_at,
  aa.registry_student_id,
  rs.first_name,
  rs.last_name,
  concat_ws(' ', rs.first_name, rs.last_name) as full_name,
  rs.oib,
  aa.ednevnik_student_id,
  aa.source_school_id,
  source_school.name as source_school_name,
  source_school.education_level as source_school_level,
  aa.target_school_id,
  target_school.name as target_school_name,
  aa.target_program_id,
  p.name as target_program_name,
  aa.school_year_id,
  sy.label as school_year_label
from public.admission_applications aa
left join public.registry_students rs on rs.id = aa.registry_student_id
left join public.schools source_school on source_school.id = aa.source_school_id
left join public.schools target_school on target_school.id = aa.target_school_id
left join public.programs p on p.id = aa.target_program_id
left join public.school_years sy on sy.id = aa.school_year_id;

grant select on public.v_ematica_user_access to authenticated;
grant select on public.v_admission_applications_detailed to authenticated;

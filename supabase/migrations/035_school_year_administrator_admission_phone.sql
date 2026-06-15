-- Shared school administrator phone for e-Upisi PIN delivery.
-- The phone is selected automatically from active school administrator profiles.

create table if not exists public.school_admission_contact_numbers (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id) on delete cascade,
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  phone text not null,
  source_profile_id uuid references public.user_profiles(id) on delete set null,
  source_role text,
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, school_year_id),
  constraint school_admission_contact_phone_not_blank check (btrim(phone) <> '')
);

drop trigger if exists set_school_admission_contact_numbers_updated_at
  on public.school_admission_contact_numbers;
create trigger set_school_admission_contact_numbers_updated_at
before update on public.school_admission_contact_numbers
for each row execute function public.set_updated_at();

alter table public.school_admission_contact_numbers enable row level security;
revoke all on public.school_admission_contact_numbers from anon, authenticated;

alter table public.admission_login_accounts
  add column if not exists delivery_method text not null default 'STUDENT_PHONE',
  add column if not exists delivery_school_id text references public.schools(id) on delete set null,
  add column if not exists delivery_school_year_id uuid references public.school_years(id) on delete set null,
  add column if not exists delivery_admin_profile_id uuid references public.user_profiles(id) on delete set null;

do $$
begin
  alter table public.admission_login_accounts
    add constraint admission_login_delivery_method_valid
    check (delivery_method in ('STUDENT_PHONE', 'SCHOOL_ADMIN_PHONE'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_admission_login_delivery_school_year
  on public.admission_login_accounts(delivery_school_id, delivery_school_year_id);

-- e-Upisi student login: password stays in Supabase Auth, while this table
-- stores only the SMS PIN hash and verification metadata.

create table if not exists public.admission_login_accounts (
  registry_student_id uuid primary key references public.registry_students(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null,
  phone text not null,
  pin_hash text,
  encrypted_pin text,
  pin_generated_at timestamptz,
  pin_requested_at timestamptz,
  pin_delivered_at timestamptz,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  verified_session_id text,
  verified_until timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admission_login_username_not_blank check (btrim(username) <> ''),
  constraint admission_login_phone_not_blank check (btrim(phone) <> ''),
  constraint admission_login_failed_attempts_valid check (failed_attempts between 0 and 20)
);

create index if not exists idx_admission_login_accounts_auth_user
  on public.admission_login_accounts(auth_user_id);

drop trigger if exists set_admission_login_accounts_updated_at
  on public.admission_login_accounts;
create trigger set_admission_login_accounts_updated_at
before update on public.admission_login_accounts
for each row execute function public.set_updated_at();

alter table public.admission_login_accounts enable row level security;

-- No direct client policies are intentionally created. All PIN writes are
-- performed by authenticated Edge Functions using the service role.

create or replace function public.mask_admission_phone(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when p_phone is null or btrim(p_phone) = '' then null
    when length(regexp_replace(p_phone, '[^0-9]', '', 'g')) <= 4 then '****'
    else
      left(regexp_replace(p_phone, '[^0-9]', '', 'g'), 3)
      || repeat('*', greatest(length(regexp_replace(p_phone, '[^0-9]', '', 'g')) - 5, 3))
      || right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 2)
  end;
$$;

create or replace function public.get_my_admission_pin_status(
  p_track public.admissions_track
)
returns table (
  candidate_exists boolean,
  phone_registered boolean,
  masked_phone text,
  username text,
  pin_assigned boolean,
  pin_verified boolean,
  verified_until timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_student public.registry_students;
  v_account public.admission_login_accounts;
  v_session_id text;
  v_candidate_exists boolean := false;
begin
  select up.id
  into v_profile_id
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
  limit 1;

  if v_profile_id is null then
    return query select false, false, null::text, null::text, false, false, null::timestamptz, 0;
    return;
  end if;

  select rs.*
  into v_student
  from public.registry_students rs
  where rs.ednevnik_student_id = v_profile_id
  order by rs.updated_at desc
  limit 1;

  if v_student.id is null then
    return query select false, false, null::text, null::text, false, false, null::timestamptz, 0;
    return;
  end if;

  select exists (
    select 1
    from public.admission_candidates ac
    where ac.registry_student_id = v_student.id
      and ac.track = p_track
  )
  into v_candidate_exists;

  select ala.*
  into v_account
  from public.admission_login_accounts ala
  where ala.registry_student_id = v_student.id;

  v_session_id := coalesce(auth.jwt() ->> 'session_id', '');

  return query
  select
    v_candidate_exists,
    nullif(btrim(v_account.phone), '') is not null,
    public.mask_admission_phone(v_account.phone),
    coalesce(v_account.username, split_part(coalesce(v_student.email, ''), '@', 1)),
    (
      v_account.pin_hash is not null
      and v_account.encrypted_pin is not null
    ),
    (
      v_account.verified_until > now()
      and coalesce(v_account.verified_session_id, '') = v_session_id
    ),
    v_account.verified_until,
    case
      when v_account.pin_requested_at is null then 0
      else greatest(0, 60 - extract(epoch from (now() - v_account.pin_requested_at))::integer)
    end;
end;
$$;

revoke all on public.admission_login_accounts from anon, authenticated;
grant execute on function public.get_my_admission_pin_status(public.admissions_track)
  to authenticated;

create or replace function public.admission_login_requires_pin(p_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admission_login_accounts ala
    where lower(ala.username) = lower(split_part(btrim(p_username), '@', 1))
      and ala.pin_hash is not null
      and ala.encrypted_pin is not null
  );
$$;

grant execute on function public.admission_login_requires_pin(text)
  to anon, authenticated;

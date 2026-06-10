-- Safe upgrade for databases where the earlier one-time PIN version of
-- migration 026 was already executed.

alter table public.admission_login_accounts
  add column if not exists encrypted_pin text,
  add column if not exists pin_generated_at timestamptz,
  add column if not exists pin_delivered_at timestamptz;

drop function if exists public.get_my_admission_pin_status(public.admissions_track);

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

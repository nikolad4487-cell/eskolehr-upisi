-- Global and school-scoped administration hierarchy.
-- Run this migration before deploying the create-school-admin Edge Function.

create or replace function public.is_ematica_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.auth_user_id = auth.uid()
      and lower(coalesce(up.access_role, '')) in ('super_admin', 'main_admin')
  );
$$;

create or replace function public.current_ematica_school_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select up.active_school_id
  from public.user_profiles up
  where up.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_ematica_school_admin(p_school_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_ematica_super_admin()
    or exists (
      select 1
      from public.user_profiles up
      where up.auth_user_id = auth.uid()
        and up.active_school_id = p_school_id
        and lower(coalesce(up.access_role, '')) in (
          'school_admin',
          'admin',
          'administrator',
          'ravnatelj',
          'strucna_sluzba'
        )
    );
$$;

grant execute on function public.is_ematica_super_admin() to authenticated;
grant execute on function public.current_ematica_school_id() to authenticated;
grant execute on function public.is_ematica_school_admin(text) to authenticated;

drop view if exists public.v_ematica_user_access;
create view public.v_ematica_user_access
with (security_invoker = true)
as
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
  lower(coalesce(up.access_role, '')) in ('super_admin', 'main_admin') as is_super_admin,
  (
    lower(coalesce(up.access_role, '')) in (
      'school_admin',
      'admin',
      'administrator',
      'ravnatelj',
      'strucna_sluzba'
    )
    and up.active_school_id is not null
  ) as is_school_admin,
  lower(coalesce(up.access_role, '')) in (
    'super_admin',
    'main_admin',
    'school_admin',
    'admin',
    'administrator',
    'ravnatelj',
    'strucna_sluzba'
  ) as is_admin,
  lower(coalesce(up.access_role, '')) in ('student', 'ucenik') as is_student,
  lower(coalesce(up.access_role, '')) in ('teacher', 'nastavnik', 'professor') as is_teacher
from public.user_profiles up
left join public.schools s on s.id = up.active_school_id;

grant select on public.v_ematica_user_access to authenticated;

-- Existing school-bound admins become explicit school administrators.
update public.user_profiles
set access_role = 'school_admin'
where lower(coalesce(access_role, '')) in ('admin', 'administrator')
  and active_school_id is not null;

-- Schools: everyone authenticated may resolve school names, but only the global
-- administrator creates/deletes schools. A school administrator may edit own school.
drop policy if exists "Authenticated users can manage schools" on public.schools;
drop policy if exists "Super admin creates schools" on public.schools;
drop policy if exists "School admins update own school" on public.schools;
drop policy if exists "Super admin deletes schools" on public.schools;

create policy "Super admin creates schools"
on public.schools for insert
to authenticated
with check (public.is_ematica_super_admin());

create policy "School admins update own school"
on public.schools for update
to authenticated
using (public.is_ematica_school_admin(id))
with check (public.is_ematica_school_admin(id));

create policy "Super admin deletes schools"
on public.schools for delete
to authenticated
using (public.is_ematica_super_admin());

-- School-owned configuration tables.
drop policy if exists "Authenticated users can manage school years" on public.school_years;
drop policy if exists "School admins manage school years" on public.school_years;
create policy "School admins manage school years"
on public.school_years for all
to authenticated
using (public.is_ematica_school_admin(school_id))
with check (public.is_ematica_school_admin(school_id));

drop policy if exists "Authenticated users can manage programs" on public.programs;
drop policy if exists "School admins manage programs" on public.programs;
create policy "School admins manage programs"
on public.programs for all
to authenticated
using (public.is_ematica_school_admin(school_id))
with check (public.is_ematica_school_admin(school_id));

drop policy if exists "Authenticated users can manage classes" on public.classes;
drop policy if exists "School admins manage classes" on public.classes;
create policy "School admins manage classes"
on public.classes for all
to authenticated
using (public.is_ematica_school_admin(school_id))
with check (public.is_ematica_school_admin(school_id));

drop policy if exists "Authenticated users can manage school enrollments" on public.student_school_enrollments;
drop policy if exists "School admins manage school enrollments" on public.student_school_enrollments;
create policy "School admins manage school enrollments"
on public.student_school_enrollments for all
to authenticated
using (public.is_ematica_school_admin(school_id))
with check (public.is_ematica_school_admin(school_id));

drop policy if exists "Authenticated users can manage class enrollments" on public.student_class_enrollments;
drop policy if exists "School admins manage class enrollments" on public.student_class_enrollments;
create policy "School admins manage class enrollments"
on public.student_class_enrollments for all
to authenticated
using (
  exists (
    select 1
    from public.classes c
    where c.id = student_class_enrollments.class_id
      and public.is_ematica_school_admin(c.school_id)
  )
)
with check (
  exists (
    select 1
    from public.classes c
    where c.id = student_class_enrollments.class_id
      and public.is_ematica_school_admin(c.school_id)
  )
);

drop policy if exists "Authenticated users can manage student transfers" on public.student_transfers;
drop policy if exists "School admins manage student transfers" on public.student_transfers;
create policy "School admins manage student transfers"
on public.student_transfers for all
to authenticated
using (
  public.is_ematica_super_admin()
  or public.is_ematica_school_admin(from_school_id)
  or public.is_ematica_school_admin(to_school_id)
)
with check (
  public.is_ematica_super_admin()
  or public.is_ematica_school_admin(from_school_id)
  or public.is_ematica_school_admin(to_school_id)
);

-- Run once after this migration, replacing the email with the real account:
-- update public.user_profiles
-- set access_role = 'super_admin', active_school_id = null
-- where lower(email) = lower('glavni.admin@eskole.me');

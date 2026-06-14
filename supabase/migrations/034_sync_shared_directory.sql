-- Keep the shared institution directory compatible with e-Matica, e-Dnevnik
-- and both admissions portals.

alter table public.schools
  add column if not exists type text;

update public.schools
set type = case education_level::text
  when 'ELEMENTARY' then 'PRIMARY'
  when 'HIGHER' then 'HIGHER'
  else 'SECONDARY'
end
where type is null
   or type not in ('PRIMARY', 'SECONDARY', 'HIGHER');

update public.user_profiles profile
set email = regexp_replace(lower(profile.email), '@eskole\.me$', '@skolehr.xyz', 'i')
where lower(profile.email) like '%@eskole.me'
  and not exists (
    select 1
    from public.user_profiles target
    where target.id <> profile.id
      and lower(target.email) = regexp_replace(lower(profile.email), '@eskole\.me$', '@skolehr.xyz', 'i')
  );

update public.registry_students student
set email = regexp_replace(lower(student.email), '@eskole\.me$', '@skolehr.xyz', 'i')
where lower(student.email) like '%@eskole.me'
  and not exists (
    select 1
    from public.registry_students target
    where target.id <> student.id
      and lower(target.email) = regexp_replace(lower(student.email), '@eskole\.me$', '@skolehr.xyz', 'i')
  );


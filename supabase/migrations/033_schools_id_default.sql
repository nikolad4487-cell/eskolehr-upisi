-- Keep school creation consistent across e-Matica and admissions portals.
create extension if not exists pgcrypto;

alter table public.schools
  alter column id set default gen_random_uuid()::text;

-- Phase 11: realistic e-Upisi candidate flow with student priority choices and program quotas.

alter table public.programs
  add column if not exists admission_track public.admissions_track,
  add column if not exists admission_capacity integer not null default 0 check (admission_capacity >= 0),
  add column if not exists admission_min_points numeric(8,2),
  add column if not exists admission_is_open boolean not null default true;

update public.programs p
set admission_track = case
  when s.education_level = 'SECONDARY' then 'SECONDARY'::public.admissions_track
  when s.education_level = 'HIGHER' then 'HIGHER_EDUCATION'::public.admissions_track
  else p.admission_track
end
from public.schools s
where s.id = p.school_id
  and p.admission_track is null;

create table if not exists public.admission_candidates (
  id uuid primary key default gen_random_uuid(),
  track public.admissions_track not null,
  registry_student_id uuid not null references public.registry_students(id) on delete cascade,
  ednevnik_student_id uuid references public.user_profiles(id) on delete set null,
  source_school_id text references public.schools(id) on delete set null,
  source_class_id text references public.classes(id) on delete set null,
  school_year_id uuid references public.school_years(id) on delete set null,
  status public.admission_application_status not null default 'DRAFT',
  total_points numeric(8,2),
  accepted_choice_id uuid,
  activated_by uuid default auth.uid() references auth.users(id) on delete set null,
  submitted_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track, registry_student_id, school_year_id)
);

create table if not exists public.admission_choices (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.admission_candidates(id) on delete cascade,
  target_school_id text not null references public.schools(id) on delete cascade,
  target_program_id uuid not null references public.programs(id) on delete cascade,
  priority integer not null check (priority between 1 and 10),
  points numeric(8,2),
  rank_position integer,
  is_in_quota boolean not null default false,
  is_accepted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, priority),
  unique (candidate_id, target_program_id)
);

alter table public.admission_candidates
  drop constraint if exists admission_candidates_accepted_choice_id_fkey,
  add constraint admission_candidates_accepted_choice_id_fkey
    foreign key (accepted_choice_id) references public.admission_choices(id) on delete set null;

create index if not exists idx_admission_candidates_track_school
  on public.admission_candidates(track, source_school_id, school_year_id);

create index if not exists idx_admission_choices_program
  on public.admission_choices(target_program_id, points desc, priority asc);

drop trigger if exists set_admission_candidates_updated_at on public.admission_candidates;
create trigger set_admission_candidates_updated_at
before update on public.admission_candidates
for each row execute function public.set_updated_at();

drop trigger if exists set_admission_choices_updated_at on public.admission_choices;
create trigger set_admission_choices_updated_at
before update on public.admission_choices
for each row execute function public.set_updated_at();

alter table public.admission_candidates enable row level security;
alter table public.admission_choices enable row level security;

drop policy if exists "Authenticated users can manage admission candidates" on public.admission_candidates;
create policy "Authenticated users can manage admission candidates"
on public.admission_candidates for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can manage admission choices" on public.admission_choices;
create policy "Authenticated users can manage admission choices"
on public.admission_choices for all
to authenticated
using (true)
with check (true);

create or replace view public.v_admission_offerings as
select
  p.id as program_id,
  p.school_id,
  s.name as school_name,
  s.education_level,
  p.name as program_name,
  p.code,
  p.duration_years,
  p.admission_track,
  p.admission_capacity,
  p.admission_min_points,
  p.admission_is_open,
  count(ac.id) filter (where ac.is_accepted) as accepted_count
from public.programs p
join public.schools s on s.id = p.school_id
left join public.admission_choices ac on ac.target_program_id = p.id
where p.admission_track is not null
group by p.id, p.school_id, s.name, s.education_level;

create or replace view public.v_admission_candidates_detailed as
select
  ac.id as candidate_id,
  ac.track,
  ac.status,
  ac.total_points,
  ac.accepted_choice_id,
  ac.registry_student_id,
  concat_ws(' ', rs.first_name, rs.last_name) as full_name,
  rs.oib,
  rs.email,
  ac.ednevnik_student_id,
  ac.source_school_id,
  ss.name as source_school_name,
  ac.source_class_id,
  c.name as source_class_name,
  ac.school_year_id,
  sy.label as school_year_label,
  ac.submitted_at,
  ac.finalized_at,
  ac.created_at
from public.admission_candidates ac
join public.registry_students rs on rs.id = ac.registry_student_id
left join public.schools ss on ss.id = ac.source_school_id
left join public.classes c on c.id = ac.source_class_id
left join public.school_years sy on sy.id = ac.school_year_id;

create or replace view public.v_admission_choices_detailed as
select
  ch.id as choice_id,
  ch.candidate_id,
  cand.track,
  cand.status as candidate_status,
  cand.registry_student_id,
  cand.ednevnik_student_id,
  concat_ws(' ', rs.first_name, rs.last_name) as full_name,
  ch.priority,
  ch.points,
  ch.rank_position,
  ch.is_in_quota,
  ch.is_accepted,
  ch.target_school_id,
  s.name as target_school_name,
  ch.target_program_id,
  p.name as target_program_name,
  p.admission_capacity,
  p.admission_min_points
from public.admission_choices ch
join public.admission_candidates cand on cand.id = ch.candidate_id
join public.registry_students rs on rs.id = cand.registry_student_id
join public.schools s on s.id = ch.target_school_id
join public.programs p on p.id = ch.target_program_id;

create or replace function public.create_class_admission_candidates(
  p_class_id text,
  p_track public.admissions_track,
  p_school_year_id uuid default null
)
returns table (
  registry_student_id uuid,
  candidate_id uuid,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  for s in
    select *
    from public.v_ematica_students_current
    where class_id = p_class_id
      and student_status = 'ACTIVE'
      and (
        (p_track = 'SECONDARY' and grade_level = 8)
        or
        (p_track = 'HIGHER_EDUCATION' and upper(class_name) in ('4.A', '4.B', '4.C', '4.D', '4.I'))
      )
  loop
    registry_student_id := s.registry_student_id;

    select ac.id into candidate_id
    from public.admission_candidates ac
    where ac.track = p_track
      and ac.registry_student_id = s.registry_student_id
      and ac.school_year_id is not distinct from coalesce(p_school_year_id, s.school_year_id)
    limit 1;

    if candidate_id is null then
      insert into public.admission_candidates (
        track,
        registry_student_id,
        ednevnik_student_id,
        source_school_id,
        source_class_id,
        school_year_id,
        status
      )
      values (
        p_track,
        s.registry_student_id,
        s.ednevnik_student_id,
        s.school_id,
        s.class_id,
        coalesce(p_school_year_id, s.school_year_id),
        'DRAFT'
      )
      returning id into candidate_id;

      result := 'CREATED';
    else
      result := 'EXISTS';
    end if;

    return next;
  end loop;
end;
$$;

create or replace function public.upsert_admission_choice(
  p_candidate_id uuid,
  p_target_program_id uuid,
  p_priority integer
)
returns public.admission_choices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.admission_candidates;
  v_program record;
  v_choice public.admission_choices;
begin
  if p_priority < 1 or p_priority > 10 then
    raise exception 'Prioritet mora biti od 1 do 10.';
  end if;

  select * into v_candidate from public.admission_candidates where id = p_candidate_id;
  if v_candidate.id is null then
    raise exception 'Kandidat ne postoji: %', p_candidate_id;
  end if;

  select p.id, p.school_id, p.admission_track, p.admission_is_open
  into v_program
  from public.programs p
  where p.id = p_target_program_id;

  if v_program.id is null then
    raise exception 'Program ne postoji: %', p_target_program_id;
  end if;

  if v_program.admission_track is distinct from v_candidate.track then
    raise exception 'Program ne pripada ovom upisnom sustavu.';
  end if;

  if v_program.admission_is_open is false then
    raise exception 'Program nije otvoren za prijave.';
  end if;

  insert into public.admission_choices (
    candidate_id,
    target_school_id,
    target_program_id,
    priority
  )
  values (
    p_candidate_id,
    v_program.school_id,
    p_target_program_id,
    p_priority
  )
  on conflict (candidate_id, target_program_id)
  do update set
    priority = excluded.priority,
    target_school_id = excluded.target_school_id,
    updated_at = now()
  returning * into v_choice;

  return v_choice;
end;
$$;

create or replace function public.submit_admission_candidate(p_candidate_id uuid)
returns public.admission_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.admission_candidates;
begin
  if not exists (select 1 from public.admission_choices where candidate_id = p_candidate_id) then
    raise exception 'Kandidat mora imati barem jedan izbor.';
  end if;

  update public.admission_candidates
  set status = 'SUBMITTED',
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
  where id = p_candidate_id
  returning * into v_candidate;

  return v_candidate;
end;
$$;

create or replace function public.calculate_admission_rankings(
  p_track public.admissions_track
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted record;
begin
  update public.admission_choices
  set rank_position = ranked.rank_position,
      is_in_quota = ranked.is_in_quota,
      is_accepted = false,
      updated_at = now()
  from (
    select
      ch.id,
      row_number() over (
        partition by ch.target_program_id
        order by coalesce(ch.points, cand.total_points, 0) desc, ch.priority asc, ch.created_at asc
      ) as rank_position,
      row_number() over (
        partition by ch.target_program_id
        order by coalesce(ch.points, cand.total_points, 0) desc, ch.priority asc, ch.created_at asc
      ) <= greatest(p.admission_capacity, 0) as is_in_quota
    from public.admission_choices ch
    join public.admission_candidates cand on cand.id = ch.candidate_id
    join public.programs p on p.id = ch.target_program_id
    where cand.track = p_track
      and cand.status in ('SUBMITTED', 'VERIFIED', 'ACCEPTED')
      and coalesce(ch.points, cand.total_points, 0) >= coalesce(p.admission_min_points, 0)
  ) ranked
  where public.admission_choices.id = ranked.id;

  update public.admission_candidates
  set accepted_choice_id = null,
      status = case when status = 'ACCEPTED' then 'VERIFIED' else status end,
      finalized_at = null
  where track = p_track;

  for accepted in
    select distinct on (ch.candidate_id)
      ch.id as choice_id,
      ch.candidate_id
    from public.admission_choices ch
    join public.admission_candidates cand on cand.id = ch.candidate_id
    where cand.track = p_track
      and ch.is_in_quota
    order by ch.candidate_id, ch.priority asc
  loop
    update public.admission_choices
    set is_accepted = (id = accepted.choice_id)
    where candidate_id = accepted.candidate_id;

    update public.admission_candidates
    set accepted_choice_id = accepted.choice_id,
        status = 'ACCEPTED',
        finalized_at = now()
    where id = accepted.candidate_id;
  end loop;
end;
$$;

grant select on public.v_admission_offerings to authenticated;
grant select on public.v_admission_candidates_detailed to authenticated;
grant select on public.v_admission_choices_detailed to authenticated;

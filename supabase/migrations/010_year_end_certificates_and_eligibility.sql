-- Phase 10: year-end pull from e-Dnevnik, certificates, and e-Upisi eligibility.

do $$
begin
  create type public.certificate_status as enum (
    'DRAFT',
    'READY',
    'ISSUED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.student_year_end_summaries (
  id uuid primary key default gen_random_uuid(),
  registry_student_id uuid not null references public.registry_students(id) on delete cascade,
  ednevnik_student_id uuid references public.user_profiles(id) on delete set null,
  class_id text references public.classes(id) on delete set null,
  school_id text references public.schools(id) on delete set null,
  school_year_id uuid references public.school_years(id) on delete set null,
  status public.student_status not null default 'ACTIVE',
  final_grade_average numeric(4,2),
  final_success_text text,
  final_grades jsonb not null default '[]'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  pulled_from_ednevnik_at timestamptz not null default now(),
  pulled_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registry_student_id, school_year_id)
);

create table if not exists public.student_certificates (
  id uuid primary key default gen_random_uuid(),
  registry_student_id uuid not null references public.registry_students(id) on delete cascade,
  year_end_summary_id uuid references public.student_year_end_summaries(id) on delete set null,
  school_id text references public.schools(id) on delete set null,
  school_year_id uuid references public.school_years(id) on delete set null,
  class_id text references public.classes(id) on delete set null,
  certificate_number text,
  status public.certificate_status not null default 'DRAFT',
  issued_at timestamptz,
  issued_by uuid default auth.uid() references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registry_student_id, school_year_id)
);

create index if not exists idx_year_end_summaries_class
  on public.student_year_end_summaries(class_id, school_year_id);

create index if not exists idx_certificates_school_year
  on public.student_certificates(school_id, school_year_id, status);

drop trigger if exists set_year_end_summaries_updated_at on public.student_year_end_summaries;
create trigger set_year_end_summaries_updated_at
before update on public.student_year_end_summaries
for each row execute function public.set_updated_at();

drop trigger if exists set_certificates_updated_at on public.student_certificates;
create trigger set_certificates_updated_at
before update on public.student_certificates
for each row execute function public.set_updated_at();

alter table public.student_year_end_summaries enable row level security;
alter table public.student_certificates enable row level security;

drop policy if exists "Authenticated users can manage year end summaries" on public.student_year_end_summaries;
create policy "Authenticated users can manage year end summaries"
on public.student_year_end_summaries for all
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can manage certificates" on public.student_certificates;
create policy "Authenticated users can manage certificates"
on public.student_certificates for all
to authenticated
using (true)
with check (true);

create or replace function public.pull_ednevnik_year_end_to_ematica(
  p_registry_student_id uuid,
  p_class_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.registry_students;
  v_class public.classes;
  v_summary_id uuid;
  v_grades jsonb;
  v_avg numeric(4,2);
begin
  select * into v_student
  from public.registry_students
  where id = p_registry_student_id;

  if v_student.id is null then
    raise exception 'e-Matica ucenik ne postoji: %', p_registry_student_id;
  end if;

  if v_student.ednevnik_student_id is null then
    raise exception 'Ucenik nije povezan s e-Dnevnikom.';
  end if;

  select * into v_class
  from public.classes
  where id = p_class_id;

  if v_class.id is null then
    raise exception 'Razred ne postoji: %', p_class_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subject_id', fg.subject_id,
        'value', fg.value,
        'period', fg.period,
        'term', fg.term,
        'note', fg.note,
        'date', fg.date
      )
      order by fg.subject_id
    ),
    '[]'::jsonb
  )
  into v_grades
  from public.final_grades fg
  where fg.student_id = v_student.ednevnik_student_id
    and fg.class_id = p_class_id;

  select avg(nullif(regexp_replace(fg.value, '[^0-9]', '', 'g'), '')::numeric)
  into v_avg
  from public.final_grades fg
  where fg.student_id = v_student.ednevnik_student_id
    and fg.class_id = p_class_id;

  insert into public.student_year_end_summaries (
    registry_student_id,
    ednevnik_student_id,
    class_id,
    school_id,
    school_year_id,
    status,
    final_grade_average,
    final_success_text,
    final_grades,
    notes
  )
  values (
    p_registry_student_id,
    v_student.ednevnik_student_id,
    p_class_id,
    v_class.school_id,
    v_class.school_year_id,
    v_student.status,
    v_avg,
    case
      when v_avg >= 4.5 then 'Odlican'
      when v_avg >= 3.5 then 'Vrlo dobar'
      when v_avg >= 2.5 then 'Dobar'
      when v_avg >= 2 then 'Dovoljan'
      when v_avg is null then null
      else 'Nedovoljan'
    end,
    v_grades,
    jsonb_build_object('source', 'ednevnik', 'pulled_at', now())
  )
  on conflict (registry_student_id, school_year_id)
  do update set
    ednevnik_student_id = excluded.ednevnik_student_id,
    class_id = excluded.class_id,
    school_id = excluded.school_id,
    status = excluded.status,
    final_grade_average = excluded.final_grade_average,
    final_success_text = excluded.final_success_text,
    final_grades = excluded.final_grades,
    notes = excluded.notes,
    pulled_from_ednevnik_at = now(),
    updated_at = now()
  returning id into v_summary_id;

  return v_summary_id;
end;
$$;

create or replace function public.pull_class_year_end_to_ematica(p_class_id text)
returns table (
  registry_student_id uuid,
  summary_id uuid,
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
    select registry_student_id
    from public.student_class_enrollments
    where class_id = p_class_id
      and registry_student_id is not null
  loop
    registry_student_id := s.registry_student_id;
    begin
      summary_id := public.pull_ednevnik_year_end_to_ematica(s.registry_student_id, p_class_id);
      result := 'PULLED';
    exception when others then
      summary_id := null;
      result := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;

create or replace function public.generate_student_certificate(
  p_summary_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary public.student_year_end_summaries;
  v_certificate_id uuid;
begin
  select * into v_summary
  from public.student_year_end_summaries
  where id = p_summary_id;

  if v_summary.id is null then
    raise exception 'Zakljucni sazetak ne postoji: %', p_summary_id;
  end if;

  insert into public.student_certificates (
    registry_student_id,
    year_end_summary_id,
    school_id,
    school_year_id,
    class_id,
    status,
    payload
  )
  values (
    v_summary.registry_student_id,
    v_summary.id,
    v_summary.school_id,
    v_summary.school_year_id,
    v_summary.class_id,
    'READY',
    jsonb_build_object(
      'summary_id', v_summary.id,
      'final_grade_average', v_summary.final_grade_average,
      'final_success_text', v_summary.final_success_text,
      'final_grades', v_summary.final_grades
    )
  )
  on conflict (registry_student_id, school_year_id)
  do update set
    year_end_summary_id = excluded.year_end_summary_id,
    class_id = excluded.class_id,
    status = 'READY',
    payload = excluded.payload,
    updated_at = now()
  returning id into v_certificate_id;

  return v_certificate_id;
end;
$$;

create or replace function public.issue_student_certificate(
  p_certificate_id uuid,
  p_certificate_number text
)
returns public.student_certificates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_certificate public.student_certificates;
begin
  update public.student_certificates
  set status = 'ISSUED',
      certificate_number = p_certificate_number,
      issued_at = now(),
      issued_by = auth.uid(),
      updated_at = now()
  where id = p_certificate_id
  returning * into v_certificate;

  if v_certificate.id is null then
    raise exception 'Svjedodzba ne postoji: %', p_certificate_id;
  end if;

  return v_certificate;
end;
$$;

create or replace view public.v_ematica_year_end_summaries as
select
  ys.id as summary_id,
  ys.registry_student_id,
  concat_ws(' ', rs.first_name, rs.last_name) as full_name,
  rs.oib,
  ys.ednevnik_student_id,
  ys.class_id,
  c.name as class_name,
  ys.school_id,
  s.name as school_name,
  ys.school_year_id,
  sy.label as school_year_label,
  ys.status,
  ys.final_grade_average,
  ys.final_success_text,
  ys.pulled_from_ednevnik_at,
  cert.id as certificate_id,
  cert.status as certificate_status,
  cert.certificate_number,
  cert.issued_at
from public.student_year_end_summaries ys
join public.registry_students rs on rs.id = ys.registry_student_id
left join public.classes c on c.id = ys.class_id
left join public.schools s on s.id = ys.school_id
left join public.school_years sy on sy.id = ys.school_year_id
left join public.student_certificates cert on cert.year_end_summary_id = ys.id;

create or replace view public.v_admissions_secondary_eligible as
select *
from public.v_ematica_students_current
where grade_level = 8
  and student_status = 'ACTIVE';

create or replace view public.v_admissions_higher_eligible as
select *
from public.v_ematica_students_current
where upper(class_name) in ('4.A', '4.B', '4.C', '4.D', '4.I')
  and student_status = 'ACTIVE';

grant select on public.v_ematica_year_end_summaries to authenticated;
grant select on public.v_admissions_secondary_eligible to authenticated;
grant select on public.v_admissions_higher_eligible to authenticated;

create or replace function public.create_class_admission_applications(
  p_class_id text,
  p_track public.admissions_track,
  p_target_school_id text default null,
  p_target_program_id uuid default null,
  p_school_year_id uuid default null
)
returns table (
  registry_student_id uuid,
  application_id uuid,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_application_id uuid;
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

    select aa.id into v_application_id
    from public.admission_applications aa
    where aa.registry_student_id = s.registry_student_id
      and aa.track = p_track
      and coalesce(aa.target_school_id, '') = coalesce(p_target_school_id, '')
      and coalesce(aa.target_program_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_target_program_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and coalesce(aa.school_year_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_school_year_id, '00000000-0000-0000-0000-000000000000'::uuid)
    limit 1;

    if v_application_id is not null then
      application_id := v_application_id;
      result := 'EXISTS';
    else
      insert into public.admission_applications (
        track,
        registry_student_id,
        ednevnik_student_id,
        source_school_id,
        target_school_id,
        target_program_id,
        school_year_id,
        status
      )
      values (
        p_track,
        s.registry_student_id,
        s.ednevnik_student_id,
        s.school_id,
        p_target_school_id,
        p_target_program_id,
        p_school_year_id,
        'DRAFT'
      )
      returning id into application_id;

      result := 'CREATED';
    end if;

    return next;
    v_application_id := null;
  end loop;
end;
$$;

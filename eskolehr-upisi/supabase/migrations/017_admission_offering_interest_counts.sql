-- Phase 17: include interest counters for admission offerings.

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
  count(ac.id) filter (where ac.is_accepted) as accepted_count,
  count(ac.id) as choice_count,
  count(ac.id) filter (where ac.priority = 1) as first_choice_count
from public.programs p
join public.schools s on s.id = p.school_id
left join public.admission_choices ac on ac.target_program_id = p.id
where p.admission_track is not null
group by p.id, p.school_id, s.name, s.education_level;

grant select on public.v_admission_offerings to authenticated;

-- Phase 16: convert accepted e-Upisi results into e-Matica school/program enrollments.

create or replace function public.enroll_accepted_admission_candidates(
  p_track public.admissions_track,
  p_school_year_id uuid default null,
  p_target_school_id text default null
)
returns table (
  registry_student_id uuid,
  school_enrollment_id uuid,
  result text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted record;
begin
  for accepted in
    select
      cand.registry_student_id,
      cand.school_year_id as candidate_school_year_id,
      ch.target_school_id,
      ch.target_program_id
    from public.admission_candidates cand
    join public.admission_choices ch on ch.id = cand.accepted_choice_id
    where cand.track = p_track
      and cand.status = 'ACCEPTED'
      and ch.is_accepted = true
      and (p_target_school_id is null or ch.target_school_id = p_target_school_id)
      and coalesce(p_school_year_id, cand.school_year_id) is not null
  loop
    registry_student_id := accepted.registry_student_id;

    select sse.id into school_enrollment_id
    from public.student_school_enrollments sse
    where sse.student_id = accepted.registry_student_id
      and sse.school_id = accepted.target_school_id
      and sse.school_year_id = coalesce(p_school_year_id, accepted.candidate_school_year_id)
      and sse.program_id is not distinct from accepted.target_program_id
      and sse.status = 'ACTIVE'
    limit 1;

    if school_enrollment_id is null then
      insert into public.student_school_enrollments (
        student_id,
        school_id,
        school_year_id,
        program_id,
        status,
        enrolled_on
      )
      values (
        accepted.registry_student_id,
        accepted.target_school_id,
        coalesce(p_school_year_id, accepted.candidate_school_year_id),
        accepted.target_program_id,
        'ACTIVE',
        current_date
      )
      returning id into school_enrollment_id;

      result := 'ENROLLED';
    else
      result := 'EXISTS';
    end if;

    update public.registry_students
    set status = 'ACTIVE',
        updated_at = now()
    where id = accepted.registry_student_id;

    return next;
  end loop;
end;
$$;

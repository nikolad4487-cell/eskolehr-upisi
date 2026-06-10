-- Phase 15: candidate points/status controls and removable student choices.

create or replace function public.update_admission_candidate_workflow(
  p_candidate_id uuid,
  p_status public.admission_application_status default null,
  p_total_points numeric default null
)
returns public.admission_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.admission_candidates;
begin
  update public.admission_candidates
  set status = coalesce(p_status, status),
      total_points = coalesce(p_total_points, total_points),
      submitted_at = case
        when p_status = 'SUBMITTED' then coalesce(submitted_at, now())
        else submitted_at
      end,
      finalized_at = case
        when p_status in ('ACCEPTED', 'REJECTED') then coalesce(finalized_at, now())
        when p_status in ('DRAFT', 'SUBMITTED', 'VERIFIED', 'RETURNED') then null
        else finalized_at
      end,
      updated_at = now()
  where id = p_candidate_id
  returning * into v_candidate;

  if v_candidate.id is null then
    raise exception 'Kandidat ne postoji: %', p_candidate_id;
  end if;

  update public.admission_choices
  set points = coalesce(p_total_points, points),
      updated_at = now()
  where candidate_id = p_candidate_id
    and p_total_points is not null;

  return v_candidate;
end;
$$;

create or replace function public.delete_admission_choice(p_choice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id uuid;
begin
  select candidate_id into v_candidate_id
  from public.admission_choices
  where id = p_choice_id;

  if v_candidate_id is null then
    raise exception 'Izbor ne postoji: %', p_choice_id;
  end if;

  delete from public.admission_choices
  where id = p_choice_id;

  update public.admission_candidates
  set accepted_choice_id = null,
      status = case when status = 'ACCEPTED' then 'VERIFIED' else status end,
      finalized_at = case when status = 'ACCEPTED' then null else finalized_at end,
      updated_at = now()
  where id = v_candidate_id
    and accepted_choice_id = p_choice_id;
end;
$$;

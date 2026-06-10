-- Phase 19: manage transfer workflow records after creation.

create or replace function public.update_student_transfer_workflow(
  p_transfer_id uuid,
  p_status public.transfer_status,
  p_reason text default null
)
returns public.student_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer public.student_transfers;
begin
  update public.student_transfers
  set status = p_status,
      reason = coalesce(p_reason, reason),
      approved_at = case
        when p_status in ('APPROVED', 'COMPLETED') then coalesce(approved_at, now())
        when p_status in ('PENDING', 'REJECTED', 'CANCELLED') then null
        else approved_at
      end,
      completed_at = case
        when p_status = 'COMPLETED' then coalesce(completed_at, now())
        when p_status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') then null
        else completed_at
      end
  where id = p_transfer_id
  returning * into v_transfer;

  if v_transfer.id is null then
    raise exception 'Premjestaj ne postoji: %', p_transfer_id;
  end if;

  return v_transfer;
end;
$$;

create or replace function public.delete_student_transfer(
  p_transfer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.student_transfers
  where id = p_transfer_id;

  if not found then
    raise exception 'Premjestaj ne postoji: %', p_transfer_id;
  end if;
end;
$$;

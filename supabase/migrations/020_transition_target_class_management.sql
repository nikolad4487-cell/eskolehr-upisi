-- Phase 20: manually set or clear target classes for school-year transition.

create or replace function public.set_transition_target_class(
  p_from_class_id text,
  p_to_class_id text default null
)
returns public.classes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.classes;
  v_to public.classes;
begin
  select * into v_from
  from public.classes
  where id = p_from_class_id;

  if v_from.id is null then
    raise exception 'Polazni razred ne postoji: %', p_from_class_id;
  end if;

  if p_to_class_id is not null then
    select * into v_to
    from public.classes
    where id = p_to_class_id;

    if v_to.id is null then
      raise exception 'Ciljni razred ne postoji: %', p_to_class_id;
    end if;

    if v_to.school_id is distinct from v_from.school_id then
      raise exception 'Ciljni razred mora biti u istoj skoli kao polazni razred.';
    end if;
  end if;

  update public.classes
  set next_class_id = p_to_class_id,
      updated_at = now()
  where id = p_from_class_id
  returning * into v_from;

  return v_from;
end;
$$;

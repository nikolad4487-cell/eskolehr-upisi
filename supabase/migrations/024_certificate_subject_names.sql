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
        'subject_name', coalesce(subject_direct.name, subject_from_class.name),
        'value', fg.value,
        'period', fg.period,
        'term', fg.term,
        'note', fg.note,
        'date', fg.date
      )
      order by coalesce(subject_direct.name, subject_from_class.name, fg.subject_id::text), fg.subject_id
    ),
    '[]'::jsonb
  )
  into v_grades
  from public.final_grades fg
  left join public.class_subjects class_subject on class_subject.id = fg.subject_id
  left join public.subjects subject_from_class on subject_from_class.id = class_subject.subject_id
  left join public.subjects subject_direct on subject_direct.id = fg.subject_id
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

with expanded as (
  select
    ys.id,
    grade.ordinality,
    grade.item,
    coalesce(subject_direct.name, subject_from_class.name) as subject_name
  from public.student_year_end_summaries ys
  cross join lateral jsonb_array_elements(coalesce(ys.final_grades, '[]'::jsonb)) with ordinality as grade(item, ordinality)
  left join public.class_subjects class_subject
    on class_subject.id::text = grade.item ->> 'subject_id'
  left join public.subjects subject_from_class
    on subject_from_class.id = class_subject.subject_id
  left join public.subjects subject_direct
    on subject_direct.id::text = grade.item ->> 'subject_id'
),
rebuilt as (
  select
    expanded.id,
    jsonb_agg(
      case
        when expanded.subject_name is not null
          then expanded.item || jsonb_build_object('subject_name', expanded.subject_name)
        else expanded.item
      end
      order by expanded.ordinality
    ) as final_grades
  from expanded
  group by expanded.id
)
update public.student_year_end_summaries ys
set final_grades = rebuilt.final_grades,
    updated_at = now()
from rebuilt
where ys.id = rebuilt.id;

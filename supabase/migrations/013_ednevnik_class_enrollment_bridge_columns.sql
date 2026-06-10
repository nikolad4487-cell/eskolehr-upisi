-- Phase 13: compatibility columns for existing e-Dnevnik class enrollments.
-- Some existing e-Dnevnik installations have class enrollments without the
-- e-Matica bridge columns used by the pull-from-e-Dnevnik sync.

alter table public.student_class_enrollments
  add column if not exists school_enrollment_id uuid references public.student_school_enrollments(id) on delete set null;

alter table public.student_class_enrollments
  add column if not exists school_year text;

alter table public.student_class_enrollments
  add column if not exists school_year_id uuid references public.school_years(id) on delete set null;

alter table public.student_class_enrollments
  add column if not exists program_id uuid references public.programs(id) on delete set null;

alter table public.student_class_enrollments
  add column if not exists registry_student_id uuid references public.registry_students(id) on delete set null;

alter table public.student_class_enrollments
  add column if not exists source_school_enrollment_id uuid references public.student_school_enrollments(id) on delete set null;

alter table public.student_class_enrollments
  add column if not exists ematica_status public.enrollment_status not null default 'ACTIVE';

alter table public.student_class_enrollments
  add column if not exists ednevnik_data_entry_blocked boolean not null default false;

create index if not exists idx_student_class_enrollments_school_enrollment_id
  on public.student_class_enrollments(school_enrollment_id);

create index if not exists idx_student_class_enrollments_registry_student_id
  on public.student_class_enrollments(registry_student_id);

create index if not exists idx_student_class_enrollments_ematica_status
  on public.student_class_enrollments(ematica_status);

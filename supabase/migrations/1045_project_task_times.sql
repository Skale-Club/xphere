-- Add optional half-hour task scheduling times for the Projects timeline.

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time;

UPDATE public.project_tasks
SET start_time = COALESCE(start_time, TIME '09:00')
WHERE start_date IS NOT NULL;

UPDATE public.project_tasks
SET end_time = COALESCE(end_time, TIME '17:00')
WHERE end_date IS NOT NULL;

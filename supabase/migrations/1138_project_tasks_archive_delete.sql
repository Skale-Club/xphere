-- Migration 1138: soft-delete and archive support for project_tasks
-- Mirrors the same columns that already exist on the `projects` table.

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

-- Index to keep active-task queries fast.
CREATE INDEX IF NOT EXISTS idx_project_tasks_active
  ON public.project_tasks (project_id, step)
  WHERE archived_at IS NULL AND deleted_at IS NULL;

-- 1043_project_task_assignee.sql
-- Adds optional assignee_id (auth.users) to project_tasks.
-- responsible_id (already present) stays as the AI/agent responsible party;
-- assignee_id is the human assigned to do the task.

ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_tasks_assignee_idx ON public.project_tasks (assignee_id);

-- Task comments for Projects MCP and human use
CREATE TABLE IF NOT EXISTS public.project_task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  author     text NOT NULL,
  author_type public.project_actor_type NOT NULL DEFAULT 'human',
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_task_comments_org ON public.project_task_comments
  USING (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS project_task_comments_task_idx ON public.project_task_comments (task_id);

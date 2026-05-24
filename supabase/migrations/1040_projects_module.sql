-- =============================================================================
-- Migration 1040: Projects Module — Full Data Model
-- Implements the lightweight project control plane (P02).
-- All tables are org-scoped with RLS via get_current_org_id().
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_task_step') THEN
    CREATE TYPE public.project_task_step AS ENUM (
      'backlog', 'todo', 'doing', 'done'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_dependency_rule') THEN
    CREATE TYPE public.project_dependency_rule AS ENUM (
      'after_done', 'after_delivered', 'after_approved'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_validation_status') THEN
    CREATE TYPE public.project_validation_status AS ENUM (
      'not_required', 'needs_review', 'approved', 'changes_requested', 'rejected'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_execution_status') THEN
    CREATE TYPE public.project_execution_status AS ENUM (
      'not_started', 'in_progress', 'delivered', 'failed', 'cancelled'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_run_status') THEN
    CREATE TYPE public.project_run_status AS ENUM (
      'running', 'paused', 'delivered', 'failed', 'cancelled'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_executor_type') THEN
    CREATE TYPE public.project_executor_type AS ENUM (
      'human', 'ai', 'system', 'automation'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_run_environment') THEN
    CREATE TYPE public.project_run_environment AS ENUM (
      'manual', 'gsd', 'claude_code', 'codex', 'ide', 'other'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_view_type') THEN
    CREATE TYPE public.project_view_type AS ENUM (
      'board', 'list', 'calendar', 'timeline'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_view_scope') THEN
    CREATE TYPE public.project_view_scope AS ENUM (
      'personal', 'project'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_mcp_area') THEN
    CREATE TYPE public.project_mcp_area AS ENUM (
      'general_xphere', 'projects'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_actor_type') THEN
    CREATE TYPE public.project_actor_type AS ENUM (
      'human', 'ai_agent', 'system'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_audit_status') THEN
    CREATE TYPE public.project_audit_status AS ENUM (
      'success', 'failed', 'blocked'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Table: projects
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  color       text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_org ON public.projects
  USING (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS projects_org_idx ON public.projects (org_id);

-- ---------------------------------------------------------------------------
-- Table: project_labels
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#6366f1',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_labels_org ON public.project_labels
  USING (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS project_labels_project_idx ON public.project_labels (project_id);

-- ---------------------------------------------------------------------------
-- Table: project_tasks  (tasks + subtasks via parent_task_id)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_task_id       uuid REFERENCES public.project_tasks(id) ON DELETE CASCADE,

  -- Core fields
  name                 text NOT NULL,
  description          text,            -- stored as Markdown
  step                 public.project_task_step NOT NULL DEFAULT 'backlog',
  responsible_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  priority             public.task_priority NOT NULL DEFAULT 'medium',
  start_date           date,
  end_date             date,
  deliverable          text,
  completed            boolean NOT NULL DEFAULT false,
  completed_at         timestamptz,

  -- AI / execution fields
  ai_context           text,
  expected_deliverable text,
  validation_criteria  text,
  ai_view_enabled      boolean NOT NULL DEFAULT false,
  needs_validation     boolean NOT NULL DEFAULT false,
  execution_status     public.project_execution_status NOT NULL DEFAULT 'not_started',
  validation_status    public.project_validation_status NOT NULL DEFAULT 'not_required',

  -- Audit timestamps
  last_agent_update    timestamptz,
  last_human_review    timestamptz,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_tasks_org ON public.project_tasks
  USING (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS project_tasks_project_idx    ON public.project_tasks (project_id);
CREATE INDEX IF NOT EXISTS project_tasks_parent_idx     ON public.project_tasks (parent_task_id);
CREATE INDEX IF NOT EXISTS project_tasks_step_idx       ON public.project_tasks (project_id, step);

-- ---------------------------------------------------------------------------
-- Table: project_task_labels  (junction)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_task_labels (
  task_id  uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES public.project_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

ALTER TABLE public.project_task_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_task_labels_org ON public.project_task_labels
  USING (
    EXISTS (
      SELECT 1 FROM public.project_tasks t
      WHERE t.id = task_id AND t.org_id = get_current_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Table: project_task_dependencies
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_task_dependencies (
  task_id         uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  depends_on_id   uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  dependency_rule public.project_dependency_rule NOT NULL DEFAULT 'after_approved',
  PRIMARY KEY (task_id, depends_on_id)
);

ALTER TABLE public.project_task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_task_deps_org ON public.project_task_dependencies
  USING (
    EXISTS (
      SELECT 1 FROM public.project_tasks t
      WHERE t.id = task_id AND t.org_id = get_current_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Table: project_execution_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_execution_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id          uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  executor_name    text,
  executor_type    public.project_executor_type NOT NULL DEFAULT 'human',
  environment      public.project_run_environment NOT NULL DEFAULT 'manual',
  start_time       timestamptz,
  end_time         timestamptz,
  duration_minutes numeric(10,2),
  status           public.project_run_status NOT NULL DEFAULT 'running',
  needs_validation boolean NOT NULL DEFAULT false,
  result           text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_execution_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_execution_runs_org ON public.project_execution_runs
  USING (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS project_exec_runs_task_idx ON public.project_execution_runs (task_id);

-- ---------------------------------------------------------------------------
-- Table: project_saved_views
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  view_type  public.project_view_type NOT NULL DEFAULT 'board',
  scope      public.project_view_scope NOT NULL DEFAULT 'personal',
  filters    jsonb NOT NULL DEFAULT '{}',
  sorting    jsonb NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_saved_views_org ON public.project_saved_views
  USING (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS project_saved_views_project_idx ON public.project_saved_views (project_id);

-- ---------------------------------------------------------------------------
-- Table: project_mcp_tokens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_mcp_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  token_prefix text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  rotated_at   timestamptz
);

ALTER TABLE public.project_mcp_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_mcp_tokens_org ON public.project_mcp_tokens
  USING (org_id = get_current_org_id());

-- ---------------------------------------------------------------------------
-- Table: project_mcp_audit_logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_mcp_audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  area       public.project_mcp_area NOT NULL DEFAULT 'projects',
  actor_type public.project_actor_type NOT NULL DEFAULT 'human',
  actor      text,
  action     text NOT NULL,
  target     text,
  status     public.project_audit_status NOT NULL DEFAULT 'success',
  timestamp  timestamptz NOT NULL DEFAULT now(),
  notes      text
);

ALTER TABLE public.project_mcp_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_mcp_audit_logs_org ON public.project_mcp_audit_logs
  USING (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS project_mcp_audit_logs_org_idx ON public.project_mcp_audit_logs (org_id, timestamp DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'projects_updated_at'
  ) THEN
    CREATE TRIGGER projects_updated_at
      BEFORE UPDATE ON public.projects
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'project_tasks_updated_at'
  ) THEN
    CREATE TRIGGER project_tasks_updated_at
      BEFORE UPDATE ON public.project_tasks
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'project_saved_views_updated_at'
  ) THEN
    CREATE TRIGGER project_saved_views_updated_at
      BEFORE UPDATE ON public.project_saved_views
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

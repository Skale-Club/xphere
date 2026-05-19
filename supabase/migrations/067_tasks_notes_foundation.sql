-- =============================================================================
-- Migration 067: Tasks & Notes Foundation — Enums + Tasks Table + RLS
-- (v2.5 Tasks & Notes CRM System / Phase 76 DB-FOUNDATION)
--
-- Creates shared CRM enums (task_priority, task_status, crm_entity_type) and
-- the tasks table. Notes table follows in migration 068.
--
-- Idempotent: safe to re-run. Pure Postgres, no Vercel-specific constructs.
--
-- Addresses: TSK-01 (partial — schema only), TSK-09, TSK-12
-- =============================================================================

-- ----- Enum: task_priority ---------------------------------------------------
-- Postgres lacks CREATE TYPE IF NOT EXISTS; guard via pg_type lookup (pattern
-- from 065_custom_field_definitions.sql).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_priority') THEN
    CREATE TYPE public.task_priority AS ENUM (
      'low',
      'medium',
      'high',
      'urgent'
    );
  END IF;
END $$;

-- ----- Enum: task_status -----------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE public.task_status AS ENUM (
      'todo',
      'in_progress',
      'done',
      'cancelled'
    );
  END IF;
END $$;

-- ----- Enum: crm_entity_type -------------------------------------------------
-- Shared by both tasks and notes (via 068). Represents the polymorphic
-- entity a task or note can be linked to.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_entity_type') THEN
    CREATE TYPE public.crm_entity_type AS ENUM (
      'contact',
      'account',
      'opportunity'
    );
  END IF;
END $$;

-- ----- Table: public.tasks ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tasks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title         text        NOT NULL,
  description   text,
  due_date      timestamptz,
  priority      public.task_priority NOT NULL DEFAULT 'medium',
  status        public.task_status   NOT NULL DEFAULT 'todo',
  assigned_to   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type   public.crm_entity_type,
  entity_id     uuid,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ----- Indexes ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_tasks_org_status
  ON public.tasks (org_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_org_due_date
  ON public.tasks (org_id, due_date)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_org_assigned_to
  ON public.tasks (org_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_entity
  ON public.tasks (entity_type, entity_id)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;

-- ----- RLS -------------------------------------------------------------------

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_org_isolation ON public.tasks;
CREATE POLICY tasks_org_isolation ON public.tasks
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ----- updated_at trigger ----------------------------------------------------

DROP TRIGGER IF EXISTS trg_tasks_set_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ----- Footer ---------------------------------------------------------------
-- NOTE: crm_entity_type is intentionally shared with the notes table (068).
-- No FK constraint is placed on entity_id because it is polymorphic — it may
-- reference contacts, accounts, or opportunities. Application-layer validation
-- enforces referential integrity for this column.
--
-- NOTE: task_priority DEFAULT is 'medium' and task_status DEFAULT is 'todo'
-- matching standard CRM conventions (HubSpot, Pipedrive).

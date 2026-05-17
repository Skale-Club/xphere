-- =============================================================================
-- Migration 055: Sales Pipeline — Kanban + Opportunities + Activity Feed
-- (SEED-008 / v2.1)
--
-- Operator replaces external CRM pipelines (GHL, Evo CRM). Four tables form the
-- in-platform sales pipeline:
--   * pipelines              — top-level funnels per org ("Vendas", "Onboarding")
--   * pipeline_stages        — ordered columns inside a pipeline ("Lead",
--                              "Qualificado", "Fechado Ganho")
--   * opportunities          — deals linked to a contact + stage + pipeline
--   * opportunity_activities — unified feed (notes, calls, messages, stage
--                              changes, won/lost) attached to an opportunity
--
-- Multi-tenant: org_id on every row, RLS via get_current_org_id().
-- =============================================================================

-- ─── pipelines ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipelines_org ON public.pipelines (org_id, position);

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipelines_org_isolation ON public.pipelines;
CREATE POLICY pipelines_org_isolation ON public.pipelines
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_pipelines_set_updated_at ON public.pipelines;
CREATE TRIGGER trg_pipelines_set_updated_at
  BEFORE UPDATE ON public.pipelines
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ─── pipeline_stages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id  uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  position     integer NOT NULL,
  color        text NOT NULL DEFAULT '#6366F1',
  is_won       boolean NOT NULL DEFAULT false,
  is_lost      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline
  ON public.pipeline_stages (pipeline_id, position);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_org
  ON public.pipeline_stages (org_id);

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_stages_org_isolation ON public.pipeline_stages;
CREATE POLICY pipeline_stages_org_isolation ON public.pipeline_stages
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ─── opportunities ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.opportunities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id           uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  pipeline_id          uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  stage_id             uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT,
  title                text NOT NULL,
  value                numeric NOT NULL DEFAULT 0,
  currency             text NOT NULL DEFAULT 'BRL',
  status               text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','won','lost')),
  expected_close_date  date,
  assigned_to          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  position             integer NOT NULL DEFAULT 0,
  custom_fields        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_pipeline_stage
  ON public.opportunities (pipeline_id, stage_id, position);
CREATE INDEX IF NOT EXISTS idx_opportunities_contact
  ON public.opportunities (contact_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_org_created
  ON public.opportunities (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_assigned
  ON public.opportunities (assigned_to)
  WHERE assigned_to IS NOT NULL;

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opportunities_org_isolation ON public.opportunities;
CREATE POLICY opportunities_org_isolation ON public.opportunities
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_opportunities_set_updated_at ON public.opportunities;
CREATE TRIGGER trg_opportunities_set_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ─── opportunity_activities ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.opportunity_activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id   uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  type             text NOT NULL
                   CHECK (type IN ('note','call','whatsapp','sms','instagram',
                                   'stage_change','email','created','won','lost')),
  content          text,
  call_log_id      uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  conversation_id  uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  metadata         jsonb,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_activities_opp
  ON public.opportunity_activities (opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_activities_org
  ON public.opportunity_activities (org_id);

ALTER TABLE public.opportunity_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opportunity_activities_org_isolation ON public.opportunity_activities;
CREATE POLICY opportunity_activities_org_isolation ON public.opportunity_activities
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ─── call_logs.opportunity_id ────────────────────────────────────────────────
-- Backlink calls to the deal they belong to. Nullable: organic inbound calls
-- with no pipeline context still log fine.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS opportunity_id uuid
  REFERENCES public.opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_opportunity
  ON public.call_logs (opportunity_id)
  WHERE opportunity_id IS NOT NULL;

-- ─── auto-activity trigger: call_logs → opportunity_activities ───────────────
-- When a call_log row is inserted (or updated) with an opportunity_id, mirror
-- it into the unified activity feed. App code may also write activities, but
-- this guarantees the feed stays in sync with any call insertion path (webhook,
-- manual log, future automation).

CREATE OR REPLACE FUNCTION public.fn_call_log_to_opportunity_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Avoid duplicate feed entries for the same call_log
  IF EXISTS (
    SELECT 1 FROM public.opportunity_activities
    WHERE call_log_id = NEW.id
  ) THEN
    -- Update existing entry (e.g. recording_url arrived later)
    UPDATE public.opportunity_activities
       SET metadata = jsonb_build_object(
             'direction', NEW.direction,
             'duration_seconds', NEW.duration_seconds,
             'status', NEW.status,
             'recording_url', NEW.recording_url
           )
     WHERE call_log_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.opportunity_activities (
    org_id, opportunity_id, type, call_log_id, metadata, created_by, created_at
  ) VALUES (
    NEW.org_id,
    NEW.opportunity_id,
    'call',
    NEW.id,
    jsonb_build_object(
      'direction', NEW.direction,
      'duration_seconds', NEW.duration_seconds,
      'status', NEW.status,
      'recording_url', NEW.recording_url
    ),
    NEW.created_by,
    COALESCE(NEW.started_at, NEW.created_at)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_log_to_opp_activity ON public.call_logs;
CREATE TRIGGER trg_call_log_to_opp_activity
  AFTER INSERT OR UPDATE OF opportunity_id, recording_url, status, duration_seconds
  ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_call_log_to_opportunity_activity();

-- ─── Default pipeline seed for existing orgs ─────────────────────────────────
-- Each existing org gets a "Sales" pipeline with five sane defaults so the UI
-- isn't empty on first visit. The trigger on org INSERT mirrors this for new
-- orgs going forward.

CREATE OR REPLACE FUNCTION public.fn_seed_default_pipeline_for_org(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id uuid;
BEGIN
  -- Idempotent: skip if any pipeline exists for the org
  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE org_id = p_org_id
   LIMIT 1;
  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  INSERT INTO public.pipelines (org_id, name, is_default, position)
  VALUES (p_org_id, 'Sales', true, 0)
  RETURNING id INTO v_pipeline_id;

  INSERT INTO public.pipeline_stages (pipeline_id, org_id, name, position, color, is_won, is_lost)
  VALUES
    (v_pipeline_id, p_org_id, 'Lead',        0, '#6366F1', false, false),
    (v_pipeline_id, p_org_id, 'Qualified',   1, '#0EA5E9', false, false),
    (v_pipeline_id, p_org_id, 'Proposal',    2, '#F59E0B', false, false),
    (v_pipeline_id, p_org_id, 'Won',         3, '#10B981', true,  false),
    (v_pipeline_id, p_org_id, 'Lost',        4, '#EF4444', false, true);

  RETURN v_pipeline_id;
END;
$$;

-- Seed for every existing org (idempotent)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.fn_seed_default_pipeline_for_org(r.id);
  END LOOP;
END $$;

-- Seed pipeline whenever a new org is created
CREATE OR REPLACE FUNCTION public.fn_org_default_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_seed_default_pipeline_for_org(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_default_pipeline ON public.organizations;
CREATE TRIGGER trg_org_default_pipeline
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_org_default_pipeline();

-- =============================================================================
-- Migration 1111: Ads Journey — história, planejamento, execução, auditoria
-- Phase: Ads Module
-- =============================================================================

-- Shared updated_at trigger function (create if not exists)
CREATE OR REPLACE FUNCTION trigger_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- ads_journey: one narrative journey per org
-- -----------------------------------------------------------------------------
CREATE TABLE public.ads_journey (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL DEFAULT 'Jornada de Ads',
  current_phase  TEXT,
  summary        TEXT,
  status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id)
);

CREATE INDEX idx_ads_journey_org_id ON public.ads_journey(org_id);

ALTER TABLE public.ads_journey ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ads_journey
  FOR ALL TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

CREATE TRIGGER ads_journey_updated_at
  BEFORE UPDATE ON public.ads_journey
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- -----------------------------------------------------------------------------
-- ads_plans: strategies, hypotheses, targets, experiments
-- -----------------------------------------------------------------------------
CREATE TABLE public.ads_plans (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journey_id    UUID        NOT NULL REFERENCES public.ads_journey(id) ON DELETE CASCADE,
  type          TEXT        NOT NULL CHECK (type IN ('strategy', 'hypothesis', 'target', 'experiment')),
  title         TEXT        NOT NULL,
  description   TEXT,
  platform      TEXT        CHECK (platform IN ('meta', 'google')),
  metric        TEXT,
  target_value  NUMERIC,
  deadline      DATE,
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'validated', 'invalidated', 'paused')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ads_plans_org_id     ON public.ads_plans(org_id);
CREATE INDEX idx_ads_plans_journey_id ON public.ads_plans(journey_id);

ALTER TABLE public.ads_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ads_plans
  FOR ALL TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

CREATE TRIGGER ads_plans_updated_at
  BEFORE UPDATE ON public.ads_plans
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- -----------------------------------------------------------------------------
-- ads_executions: campaign actions (AI or manual)
-- -----------------------------------------------------------------------------
CREATE TABLE public.ads_executions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journey_id       UUID        NOT NULL REFERENCES public.ads_journey(id) ON DELETE CASCADE,
  plan_id          UUID        REFERENCES public.ads_plans(id) ON DELETE SET NULL,
  type             TEXT        NOT NULL CHECK (type IN (
                     'campaign_pause', 'campaign_enable', 'budget_increase', 'budget_decrease',
                     'campaign_launch', 'audience_change', 'creative_change', 'manual'
                   )),
  platform         TEXT        CHECK (platform IN ('meta', 'google')),
  title            TEXT        NOT NULL,
  description      TEXT,
  campaign_id      TEXT,
  campaign_name    TEXT,
  before_value     TEXT,
  after_value      TEXT,
  executed_by_ai   BOOLEAN     NOT NULL DEFAULT FALSE,
  executed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ads_executions_org_id     ON public.ads_executions(org_id);
CREATE INDEX idx_ads_executions_journey_id ON public.ads_executions(journey_id);
CREATE INDEX idx_ads_executions_executed_at ON public.ads_executions(executed_at DESC);

ALTER TABLE public.ads_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ads_executions
  FOR ALL TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- -----------------------------------------------------------------------------
-- ads_audits: periodic performance reviews with AI-generated insights
-- -----------------------------------------------------------------------------
CREATE TABLE public.ads_audits (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journey_id           UUID        NOT NULL REFERENCES public.ads_journey(id) ON DELETE CASCADE,
  period_type          TEXT        NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'quarterly', 'custom')),
  period_from          DATE        NOT NULL,
  period_to            DATE        NOT NULL,
  title                TEXT        NOT NULL,
  spend_total          NUMERIC     NOT NULL DEFAULT 0,
  leads_total          INT         NOT NULL DEFAULT 0,
  opportunities_total  INT         NOT NULL DEFAULT 0,
  revenue_total        NUMERIC     NOT NULL DEFAULT 0,
  summary              TEXT,
  wins                 TEXT,
  misses               TEXT,
  learnings            TEXT,
  recommendations      TEXT,
  plans_validated      JSONB       NOT NULL DEFAULT '[]',
  plans_invalidated    JSONB       NOT NULL DEFAULT '[]',
  status               TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ads_audits_org_id     ON public.ads_audits(org_id);
CREATE INDEX idx_ads_audits_journey_id ON public.ads_audits(journey_id);
CREATE INDEX idx_ads_audits_period     ON public.ads_audits(period_from DESC);

ALTER TABLE public.ads_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ads_audits
  FOR ALL TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

CREATE TRIGGER ads_audits_updated_at
  BEFORE UPDATE ON public.ads_audits
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

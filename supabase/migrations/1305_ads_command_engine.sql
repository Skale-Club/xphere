-- =============================================================================
-- Migration 1305: Ads Command Engine — change ledger, event log, account policies
-- =============================================================================
-- Every write to an ad platform (Google Ads, Meta Ads) now goes through one
-- command engine instead of being called directly from a route. This migration
-- adds the three tables that engine needs:
--
--   ads_change_requests  one row per intended change: who asked, what the
--                        resource looked like before, what it should look like
--                        after, the policy verdict, approval, provider result
--                        and the post-write verification.
--   ads_change_events    append-only state-transition log for those requests.
--                        UPDATE/DELETE are rejected by trigger, even for the
--                        service role — history is never rewritten; a rollback
--                        is a new request pointing at the old one.
--   ads_account_policies per-org (and optionally per-account) guardrails:
--                        budget ceilings, protected campaigns, what the AI may
--                        do. A NULL ad_account_id row is the org-wide default.
--
-- ads_executions keeps feeding the journey timeline; it is written by the
-- engine after a verified change, so the timeline is unchanged for readers.
--
-- Write model: rows are written by the server with the service-role client
-- after the application has authenticated the actor and checked permissions
-- (dashboard session, MCP token or cron). Authenticated clients get SELECT
-- only, so a browser holding a user JWT cannot forge an approval or a policy.
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS throughout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ads_change_requests
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ads_change_requests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform             TEXT        NOT NULL CHECK (platform IN ('meta', 'google')),
  ad_account_id        TEXT        NOT NULL,

  command_type         TEXT        NOT NULL,
  resource_type        TEXT        NOT NULL,
  resource_id          TEXT,
  resource_name        TEXT,
  -- Parent campaign, when the resource is below one — lets the history view
  -- show "everything that happened to campaign X" in one query.
  campaign_id          TEXT,

  payload              JSONB       NOT NULL,
  before_state         JSONB,
  before_hash          TEXT,
  intended_state       JSONB,
  diff                 JSONB       NOT NULL DEFAULT '[]'::jsonb,
  warnings             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  policy_verdict       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  risk_level           SMALLINT    NOT NULL CHECK (risk_level BETWEEN 1 AND 4),

  status               TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
                         'draft', 'validating', 'awaiting_approval', 'queued',
                         'executing', 'verifying', 'succeeded', 'failed',
                         'drifted', 'cancelled', 'expired')),

  actor_type           TEXT        NOT NULL CHECK (actor_type IN ('user', 'ai', 'workflow', 'system')),
  actor_id             UUID,
  actor_label          TEXT,
  idempotency_key      TEXT        NOT NULL,

  approval_required    BOOLEAN     NOT NULL DEFAULT false,
  approved_by          UUID,
  approved_by_label    TEXT,
  approved_at          TIMESTAMPTZ,
  approval_expires_at  TIMESTAMPTZ,
  -- SHA-256 of a one-time nonce returned only in the preview response. An AI
  -- client must echo the nonce to approve, which binds the approval to the
  -- exact diff that was shown.
  confirmation_hash    TEXT,

  attempt_count        INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at      TIMESTAMPTZ,
  provider_ref         TEXT,
  provider_result      JSONB,
  error_code           TEXT,
  error_message        TEXT,
  verification         JSONB,

  rollback_of          UUID        REFERENCES public.ads_change_requests(id) ON DELETE SET NULL,
  batch_id             UUID,

  executed_at          TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ads_change_requests_idempotency
  ON public.ads_change_requests (org_id, idempotency_key);
CREATE INDEX IF NOT EXISTS ads_change_requests_org_created
  ON public.ads_change_requests (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ads_change_requests_account
  ON public.ads_change_requests (org_id, platform, ad_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ads_change_requests_campaign
  ON public.ads_change_requests (org_id, campaign_id) WHERE campaign_id IS NOT NULL;
-- The retry worker's scan: only rows that are actually waiting.
CREATE INDEX IF NOT EXISTS ads_change_requests_queue
  ON public.ads_change_requests (next_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS ads_change_requests_pending
  ON public.ads_change_requests (org_id, approval_expires_at) WHERE status = 'awaiting_approval';

ALTER TABLE public.ads_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.ads_change_requests;
CREATE POLICY "org_read" ON public.ads_change_requests
  FOR SELECT TO authenticated
  USING (org_id = public.get_current_org_id());

DROP TRIGGER IF EXISTS ads_change_requests_updated_at ON public.ads_change_requests;
CREATE TRIGGER ads_change_requests_updated_at
  BEFORE UPDATE ON public.ads_change_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- -----------------------------------------------------------------------------
-- ads_change_events (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ads_change_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  change_request_id  UUID        NOT NULL REFERENCES public.ads_change_requests(id) ON DELETE CASCADE,
  event_type         TEXT        NOT NULL,
  from_status        TEXT,
  to_status          TEXT,
  actor_type         TEXT        NOT NULL CHECK (actor_type IN ('user', 'ai', 'workflow', 'system')),
  actor_id           UUID,
  actor_label        TEXT,
  detail             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ads_change_events_request
  ON public.ads_change_events (change_request_id, created_at);
CREATE INDEX IF NOT EXISTS ads_change_events_org
  ON public.ads_change_events (org_id, created_at DESC);

ALTER TABLE public.ads_change_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.ads_change_events;
CREATE POLICY "org_read" ON public.ads_change_events
  FOR SELECT TO authenticated
  USING (org_id = public.get_current_org_id());

CREATE OR REPLACE FUNCTION public.ads_change_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  -- ON DELETE CASCADE from organizations/ads_change_requests still has to
  -- work when a whole org is removed; that path runs with no row left in
  -- the parent, which is how we tell it apart from an ad-hoc DELETE.
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.ads_change_requests WHERE id = OLD.change_request_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ads_change_events is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ads_change_events_no_update ON public.ads_change_events;
CREATE TRIGGER ads_change_events_no_update
  BEFORE UPDATE OR DELETE ON public.ads_change_events
  FOR EACH ROW EXECUTE FUNCTION public.ads_change_events_append_only();

-- -----------------------------------------------------------------------------
-- ads_account_policies
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ads_account_policies (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform                   TEXT        CHECK (platform IN ('meta', 'google')),
  -- NULL = org-wide default. A per-account row overrides the default field by
  -- field (a NULL column on the account row inherits the org value).
  ad_account_id              TEXT,

  max_daily_budget           NUMERIC     CHECK (max_daily_budget IS NULL OR max_daily_budget > 0),
  max_budget_increase_pct    NUMERIC     CHECK (max_budget_increase_pct IS NULL OR max_budget_increase_pct > 0),
  allow_enable               BOOLEAN,
  allow_bidding_changes      BOOLEAN,
  allow_bulk                 BOOLEAN,
  ai_mode                    TEXT        CHECK (ai_mode IS NULL OR ai_mode IN ('read_only', 'propose', 'execute_with_confirmation')),
  require_approval_min_risk  SMALLINT    CHECK (require_approval_min_risk IS NULL OR require_approval_min_risk BETWEEN 1 AND 5),
  approval_ttl_minutes       INTEGER     CHECK (approval_ttl_minutes IS NULL OR approval_ttl_minutes BETWEEN 5 AND 10080),
  protected_campaign_ids     TEXT[]      NOT NULL DEFAULT '{}',

  updated_by                 UUID,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (ad_account_id IS NULL OR platform IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ads_account_policies_scope
  ON public.ads_account_policies (org_id, COALESCE(platform, ''), COALESCE(ad_account_id, ''));

ALTER TABLE public.ads_account_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.ads_account_policies;
CREATE POLICY "org_read" ON public.ads_account_policies
  FOR SELECT TO authenticated
  USING (org_id = public.get_current_org_id());

DROP TRIGGER IF EXISTS ads_account_policies_updated_at ON public.ads_account_policies;
CREATE TRIGGER ads_account_policies_updated_at
  BEFORE UPDATE ON public.ads_account_policies
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- -----------------------------------------------------------------------------
-- Link the journey timeline back to the ledger row that produced it.
-- -----------------------------------------------------------------------------
ALTER TABLE public.ads_executions
  ADD COLUMN IF NOT EXISTS change_request_id UUID
    REFERENCES public.ads_change_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ads_executions_change_request
  ON public.ads_executions (change_request_id) WHERE change_request_id IS NOT NULL;

-- =============================================================================
-- Migration: 027_manychat_rules
-- Phase: v1.6 ManyChat Integration — Phase 23 Inbound Routing
-- Creates: manychat_rules (event_type + condition JSONB → tool_config dispatch)
-- Backfills: deferred FK constraints on manychat_events.matched_rule_id and
--            manychat_events.action_log_id (added late because target tables
--            did not exist when migration 026 ran).
-- Index: composite on (org_id, channel_id, event_type, is_active, priority)
--        — matches the dispatcher hot-path WHERE/ORDER BY pattern.
-- Note: priority is ASC (lower number wins) — first-match-wins semantics.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.manychat_rules (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id      UUID         NOT NULL REFERENCES public.manychat_channels(id) ON DELETE CASCADE,
  event_type      TEXT         NOT NULL,
  condition       JSONB        NOT NULL DEFAULT '{}',
  tool_config_id  UUID         NOT NULL REFERENCES public.tool_configs(id) ON DELETE RESTRICT,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  priority        INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.manychat_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.manychat_rules
  FOR ALL
  TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

CREATE TRIGGER trg_manychat_rules_updated_at
  BEFORE UPDATE ON public.manychat_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Composite index — dispatcher queries:
--   WHERE org_id=$1 AND channel_id=$2 AND event_type=$3 AND is_active=true ORDER BY priority ASC
CREATE INDEX idx_manychat_rules_match
  ON public.manychat_rules (org_id, channel_id, event_type, is_active, priority);

-- Backfill the FKs Phase 22 deferred (target tables now exist)
ALTER TABLE public.manychat_events
  ADD CONSTRAINT manychat_events_matched_rule_id_fkey
  FOREIGN KEY (matched_rule_id)
  REFERENCES public.manychat_rules(id)
  ON DELETE SET NULL;

ALTER TABLE public.manychat_events
  ADD CONSTRAINT manychat_events_action_log_id_fkey
  FOREIGN KEY (action_log_id)
  REFERENCES public.action_logs(id)
  ON DELETE SET NULL;

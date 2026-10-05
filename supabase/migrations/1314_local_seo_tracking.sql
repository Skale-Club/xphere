-- =============================================================================
-- Migration 1314: Local SEO continuous tracking — schedules, pinned
-- competitors, alert rules, fired alerts, annotations
-- =============================================================================
-- Phase 2 of .planning/local-seo/SPEC.md.
--
--   local_seo_schedules      recurring scans of a location (all or some of its
--                            keywords). The tick creates scans for schedules
--                            whose next_run_at has passed; minute_utc spreads
--                            schedules across the hour so they do not all
--                            fire on :00.
--   local_seo_competitors    competitors an operator pinned to follow.
--   local_seo_alert_rules    "tell me when SoLV drops by 10 points": a metric,
--                            a direction and a threshold, per org or location.
--   local_seo_alerts         alerts that fired (server-written).
--   local_seo_annotations    dated notes shown on the trend charts (manual, or
--                            written by the platform when e.g. a post goes
--                            live), to correlate a change with a ranking move.
--
-- Also lets notifications carry the new 'local_seo_alert' type.
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS throughout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- local_seo_schedules
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_schedules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id   UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  -- Empty = every active keyword of the location at run time.
  keyword_ids   UUID[]      NOT NULL DEFAULT '{}',
  -- NULL = the location's defaults at run time.
  grid_size     INTEGER     CHECK (grid_size IN (3, 5, 7, 9, 11, 13)),
  spacing_m     INTEGER     CHECK (spacing_m BETWEEN 100 AND 20000),
  shape         TEXT        CHECK (shape IN ('square', 'circle')),
  frequency     TEXT        NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  -- 0 = Sunday. Used by weekly/biweekly.
  weekday       INTEGER     NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6),
  -- Used by monthly; capped at 28 so every month has the day.
  day_of_month  INTEGER     NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  hour_utc      INTEGER     NOT NULL DEFAULT 6 CHECK (hour_utc BETWEEN 0 AND 23),
  minute_utc    INTEGER     NOT NULL DEFAULT 0 CHECK (minute_utc BETWEEN 0 AND 59),
  next_run_at   TIMESTAMPTZ NOT NULL,
  last_run_at   TIMESTAMPTZ,
  last_error    TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_schedules_due
  ON public.local_seo_schedules (next_run_at) WHERE is_active;
CREATE INDEX IF NOT EXISTS local_seo_schedules_location
  ON public.local_seo_schedules (location_id);

ALTER TABLE public.local_seo_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_local_seo_schedules" ON public.local_seo_schedules;
CREATE POLICY "org_local_seo_schedules" ON public.local_seo_schedules
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS local_seo_schedules_updated_at ON public.local_seo_schedules;
CREATE TRIGGER local_seo_schedules_updated_at
  BEFORE UPDATE ON public.local_seo_schedules
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_seo_scans_schedule_fk') THEN
    ALTER TABLE public.local_seo_scans
      ADD CONSTRAINT local_seo_scans_schedule_fk
      FOREIGN KEY (schedule_id) REFERENCES public.local_seo_schedules(id) ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- local_seo_competitors (pinned)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_competitors (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id     UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  competitor_key  TEXT        NOT NULL,
  place_id        TEXT,
  title           TEXT        NOT NULL,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, competitor_key)
);

ALTER TABLE public.local_seo_competitors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_local_seo_competitors" ON public.local_seo_competitors;
CREATE POLICY "org_local_seo_competitors" ON public.local_seo_competitors
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- local_seo_alert_rules
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_alert_rules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL = every location of the org.
  location_id  UUID        REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  metric       TEXT        NOT NULL CHECK (metric IN ('solv', 'arp', 'atrp', 'found_pct')),
  -- 'worse' respects each metric's polarity: a lower SoLV or a higher ARP.
  direction    TEXT        NOT NULL DEFAULT 'worse' CHECK (direction IN ('worse', 'better', 'any')),
  threshold    NUMERIC(6, 2) NOT NULL CHECK (threshold > 0),
  channels     TEXT[]      NOT NULL DEFAULT '{in_app}',
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_alert_rules_org
  ON public.local_seo_alert_rules (org_id) WHERE is_active;

ALTER TABLE public.local_seo_alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_local_seo_alert_rules" ON public.local_seo_alert_rules;
CREATE POLICY "org_local_seo_alert_rules" ON public.local_seo_alert_rules
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS local_seo_alert_rules_updated_at ON public.local_seo_alert_rules;
CREATE TRIGGER local_seo_alert_rules_updated_at
  BEFORE UPDATE ON public.local_seo_alert_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- -----------------------------------------------------------------------------
-- local_seo_alerts (server-written)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_alerts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id       UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  keyword_id        UUID        REFERENCES public.local_seo_keywords(id) ON DELETE SET NULL,
  keyword           TEXT        NOT NULL,
  scan_id           UUID        NOT NULL REFERENCES public.local_seo_scans(id) ON DELETE CASCADE,
  previous_scan_id  UUID        REFERENCES public.local_seo_scans(id) ON DELETE SET NULL,
  rule_id           UUID        REFERENCES public.local_seo_alert_rules(id) ON DELETE SET NULL,
  metric            TEXT        NOT NULL,
  previous_value    NUMERIC(6, 2),
  current_value     NUMERIC(6, 2),
  delta             NUMERIC(6, 2) NOT NULL,
  is_worse          BOOLEAN     NOT NULL,
  acknowledged_at   TIMESTAMPTZ,
  acknowledged_by   UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, rule_id)
);

CREATE INDEX IF NOT EXISTS local_seo_alerts_open
  ON public.local_seo_alerts (org_id, location_id, created_at DESC) WHERE acknowledged_at IS NULL;

ALTER TABLE public.local_seo_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_alerts;
CREATE POLICY "org_read" ON public.local_seo_alerts
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- local_seo_annotations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_annotations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id  UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  occurred_at  TIMESTAMPTZ NOT NULL,
  kind         TEXT        NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'post', 'profile_change', 'review', 'website', 'other')),
  title        TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  note         TEXT,
  ref_id       TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_annotations_location
  ON public.local_seo_annotations (location_id, occurred_at DESC);

ALTER TABLE public.local_seo_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_local_seo_annotations" ON public.local_seo_annotations;
CREATE POLICY "org_local_seo_annotations" ON public.local_seo_annotations
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- notifications: allow the local_seo_alert type
-- -----------------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'new_conversation', 'missed_call', 'flow_failed', 'new_message', 'incoming_call',
    'handoff_requested', 'local_seo_alert'
  ));

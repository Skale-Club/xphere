-- =============================================================================
-- Migration 1317: Local SEO white-label reports
-- =============================================================================
-- Phase 6 of .planning/local-seo/SPEC.md.
--
--   local_seo_reports        a saved report: which locations, which sections,
--                            the period, and optionally a monthly email to a
--                            list of recipients (PDF attached)
--   local_seo_report_shares  public links (/r/local-seo/<token>) with expiry
--                            and revocation. The token is random; only its
--                            SHA-256 is stored, like api_keys.
--
-- Reports are operator configuration (RLS read/write for the org). Shares are
-- created by the server so the plaintext token is shown exactly once.
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.local_seo_reports (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  location_ids   UUID[]      NOT NULL DEFAULT '{}',
  -- Rolling window the report covers, in days.
  period_days    INTEGER     NOT NULL DEFAULT 30 CHECK (period_days IN (7, 30, 90)),
  sections       TEXT[]      NOT NULL DEFAULT '{rankings,trends,competitors,reviews,performance,audit}',
  intro          TEXT,
  schedule       TEXT        NOT NULL DEFAULT 'none' CHECK (schedule IN ('none', 'monthly')),
  -- Day of month the scheduled email goes out (UTC morning).
  send_day       INTEGER     NOT NULL DEFAULT 1 CHECK (send_day BETWEEN 1 AND 28),
  recipients     TEXT[]      NOT NULL DEFAULT '{}',
  last_sent_at   TIMESTAMPTZ,
  last_error     TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.local_seo_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_local_seo_reports" ON public.local_seo_reports;
CREATE POLICY "org_local_seo_reports" ON public.local_seo_reports
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS local_seo_reports_updated_at ON public.local_seo_reports;
CREATE TRIGGER local_seo_reports_updated_at
  BEFORE UPDATE ON public.local_seo_reports
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

CREATE TABLE IF NOT EXISTS public.local_seo_report_shares (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_id   UUID        NOT NULL REFERENCES public.local_seo_reports(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  -- First characters, to recognise a link in the list without storing it.
  token_hint  TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  view_count  INTEGER     NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_report_shares_report ON public.local_seo_report_shares (report_id);

ALTER TABLE public.local_seo_report_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_report_shares;
CREATE POLICY "org_read" ON public.local_seo_report_shares
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

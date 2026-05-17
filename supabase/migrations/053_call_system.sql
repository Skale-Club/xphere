-- =============================================================================
-- Migration 053: Call System — Twilio Voice with 3 routing modes (SEED-007 / v2.1)
--
-- Operator's call system replaces external CRM calling (e.g., GHL voice).
-- Two tables:
--   * call_settings — per-user routing configuration (phone_forward / sip / browser)
--   * call_logs     — every inbound/outbound call (with recording URLs from Hetzner)
--
-- Multi-tenant: org_id FK + RLS via get_current_org_id()
-- Linked to contacts.id (nullable — set null on contact delete)
-- =============================================================================

-- ── call_settings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_settings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  routing_mode             text NOT NULL DEFAULT 'phone_forward'
                           CHECK (routing_mode IN ('phone_forward','sip','browser')),
  phone_forward            text,
  sip_username             text,
  sip_password_encrypted   text,
  twilio_client_identity   text,
  record_calls             boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_call_settings_org_user
  ON public.call_settings (org_id, user_id);

ALTER TABLE public.call_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_settings_org_isolation ON public.call_settings;
CREATE POLICY call_settings_org_isolation ON public.call_settings
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_call_settings_set_updated_at ON public.call_settings;
CREATE TRIGGER trg_call_settings_set_updated_at
  BEFORE UPDATE ON public.call_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ── call_logs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id         uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  call_sid           text NOT NULL UNIQUE,
  direction          text NOT NULL CHECK (direction IN ('inbound','outbound')),
  routing_mode       text,
  from_number        text,
  to_number          text,
  status             text,
  duration_seconds   integer,
  recording_url      text,
  recording_duration integer,
  started_at         timestamptz,
  ended_at           timestamptz,
  notes              text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_contact
  ON public.call_logs (contact_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_org_date
  ON public.call_logs (org_id, started_at DESC);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_logs_org_isolation ON public.call_logs;
CREATE POLICY call_logs_org_isolation ON public.call_logs
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

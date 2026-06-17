-- Migration 1216: Meta Conversions API (CAPI) — per-org config + event outbox.
--
-- meta_capi_config : one row per org. Holds the dataset/pixel target, optional
--   dedicated encrypted CAPI token (falls back to ads_connections / system-user),
--   test_event_code, enable toggles, and the event map (which funnel events fire
--   and where the Purchase value comes from).
--
-- meta_capi_events : durable outbox. emitContactEvent / emitOpportunityEvent
--   enqueue a row (payload already SHA-256 hashed — no raw PII at rest); the
--   worker (scripts/meta-capi-worker.ts) POSTs to /{dataset_id}/events with
--   retry/backoff and dead-letters after repeated failures. The deterministic
--   event_id guarantees idempotency across retries and dedups against the
--   browser Pixel.

-- ─── Config ─────────────────────────────────────────────────────────────────

CREATE TABLE public.meta_capi_config (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meta_ad_account_id    text,                       -- e.g. 'act_123456789' (for token/pixel discovery)
  dataset_id            text,                       -- Events Manager dataset / pixel id (POST target)
  pixel_id              text,                       -- browser Pixel id (usually == dataset_id)
  encrypted_capi_token  text,                       -- AES-256-GCM; NULL → use ads_connections / system-user token
  test_event_code       text,                       -- Events Manager → Test Events code (optional)
  enabled               boolean     NOT NULL DEFAULT false,
  browser_pixel_enabled boolean     NOT NULL DEFAULT false,
  default_currency      text        NOT NULL DEFAULT 'USD',
  event_map             jsonb       NOT NULL DEFAULT jsonb_build_object(
                          'lead',      jsonb_build_object('enabled', true),
                          'qualified', jsonb_build_object('enabled', true, 'stage_name', 'Qualified'),
                          'purchase',  jsonb_build_object('enabled', true, 'value_source', 'opportunity_value')
                        ),
  last_status           jsonb,                      -- { last_run, sent, failed, dead }
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

ALTER TABLE public.meta_capi_config ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER meta_capi_config_updated_at
  BEFORE UPDATE ON public.meta_capi_config
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

CREATE POLICY "meta_capi_config_select" ON public.meta_capi_config
  FOR SELECT USING (org_id = public.get_current_org_id());
CREATE POLICY "meta_capi_config_insert" ON public.meta_capi_config
  FOR INSERT WITH CHECK (org_id = public.get_current_org_id());
CREATE POLICY "meta_capi_config_update" ON public.meta_capi_config
  FOR UPDATE USING (org_id = public.get_current_org_id());
CREATE POLICY "meta_capi_config_delete" ON public.meta_capi_config
  FOR DELETE USING (org_id = public.get_current_org_id());

-- ─── Outbox ─────────────────────────────────────────────────────────────────

CREATE TABLE public.meta_capi_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_name      text        NOT NULL,             -- 'Lead' | 'Purchase' | ...
  event_id        text        NOT NULL,             -- dedup / idempotency key
  event_time      timestamptz NOT NULL DEFAULT now(),
  action_source   text        NOT NULL DEFAULT 'website',   -- 'website' | 'system_generated'
  source_table    text,                             -- 'contacts' | 'opportunities'
  source_id       uuid,
  payload         jsonb       NOT NULL,             -- { user_data (hashed), custom_data, event_source_url }
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed','dead')),
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  fb_trace_id     text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One row per logical conversion (idempotent enqueue / safe re-emit).
  UNIQUE (org_id, event_name, event_id)
);

-- Worker scan: due rows that still need sending.
CREATE INDEX meta_capi_events_due_idx
  ON public.meta_capi_events (next_attempt_at)
  WHERE status IN ('pending','failed');

ALTER TABLE public.meta_capi_events ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER meta_capi_events_updated_at
  BEFORE UPDATE ON public.meta_capi_events
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- Read-only to org members (observability panel). Writes happen via the
-- service-role client (enqueue + worker), which bypasses RLS.
CREATE POLICY "meta_capi_events_select" ON public.meta_capi_events
  FOR SELECT USING (org_id = public.get_current_org_id());

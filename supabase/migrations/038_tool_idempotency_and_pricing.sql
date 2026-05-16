-- =============================================================================
-- Migration: 038_tool_idempotency_and_pricing
-- Phase: v2.0 Multi-Bot Platform — Phase 33 Schema Foundation
-- Creates: public.tool_idempotency_keys (per-org tool-call cache, ~24h TTL)
--          public.agent_model_pricing (flat model -> price reference, OBS-03)
-- RLS:     tool_idempotency_keys org-scoped (canonical pattern);
--          agent_model_pricing read-public (no RLS) — write via service-role only
-- Seed:    7 launch model pricing rows (rates as of 2026-05-16 — verify at execute time)
-- Decisions: D-33-01 (migration 5 of 6)
--            D-33-15 (agent_model_pricing.model is PRIMARY KEY)
--            Specifics — minimum 7 models seeded
-- TTL cleanup for tool_idempotency_keys is deferred to Phase 38 (D-33 deferred).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tool_idempotency_keys: cache tool-call responses for ~24h to dedupe replay
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tool_idempotency_keys (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_invocation_id  UUID         REFERENCES public.agent_invocations(id) ON DELETE SET NULL,
  idempotency_key      TEXT         NOT NULL,
  tool_name            TEXT         NOT NULL,
  request_hash         TEXT         NOT NULL,
  response             JSONB        NOT NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ  NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT uniq_tool_idem_org_key UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.tool_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tool_idem_org_key
  ON public.tool_idempotency_keys(organization_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_tool_idem_expires
  ON public.tool_idempotency_keys(expires_at);

DROP POLICY IF EXISTS "tool_idempotency_keys_all" ON public.tool_idempotency_keys;
CREATE POLICY "tool_idempotency_keys_all" ON public.tool_idempotency_keys
  FOR ALL TO authenticated
  USING      (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.tool_idempotency_keys IS
  'Phase 33 (v2.0): per-org tool-call response cache. Phase 38 dispatcher checks (org, idempotency_key) before re-executing a tool. Rows expire after 24h; cleanup job lands in Phase 38.';

-- ---------------------------------------------------------------------------
-- agent_model_pricing: flat reference table (OBS-03)
-- No RLS — read-public reference data; writes via service-role only
-- model is the PRIMARY KEY (D-33-15)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_model_pricing (
  model                    TEXT         PRIMARY KEY,
  source                   TEXT         NOT NULL,
  input_per_1m_usd         NUMERIC(10,4) NOT NULL CHECK (input_per_1m_usd >= 0),
  output_per_1m_usd        NUMERIC(10,4) NOT NULL CHECK (output_per_1m_usd >= 0),
  notes                    TEXT,
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Intentionally no RLS — global reference table. To restrict writes, only the
-- service-role key has INSERT/UPDATE/DELETE because anon and authenticated
-- have no DML grants by default in this project.
-- (No ENABLE ROW LEVEL SECURITY; no policy needed.)

DROP TRIGGER IF EXISTS trg_agent_model_pricing_updated_at ON public.agent_model_pricing;
CREATE TRIGGER trg_agent_model_pricing_updated_at
  BEFORE UPDATE ON public.agent_model_pricing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.agent_model_pricing IS
  'Phase 33 (v2.0): OBS-03 flat model->price reference. Phase 34 cost calculator joins on model to compute agent_invocations.cost_usd. Pricing as of 2026-05-16 — service-role updates as vendor pricing changes.';

-- ---------------------------------------------------------------------------
-- Seed: 7 launch models. Rates current as of 2026-05-16. VERIFY AT EXECUTE TIME.
-- Anthropic: anthropic.com/pricing
-- OpenAI:    openai.com/api/pricing
-- Google:    ai.google.dev/pricing
-- Format:    USD per 1,000,000 tokens (input / output)
-- ---------------------------------------------------------------------------

INSERT INTO public.agent_model_pricing (model, source, input_per_1m_usd, output_per_1m_usd, notes) VALUES
  ('anthropic/claude-opus-4-7',     'anthropic', 15.0000, 75.0000, 'Most capable Anthropic model — high cost, deep reasoning'),
  ('anthropic/claude-sonnet-4-6',   'anthropic',  3.0000, 15.0000, 'Balanced Anthropic — default chat model'),
  ('anthropic/claude-haiku-4-5',    'anthropic',  0.8000,  4.0000, 'Fastest/cheapest Anthropic — agents.model default'),
  ('openai/gpt-4o',                 'openai',     2.5000, 10.0000, 'OpenAI flagship multimodal'),
  ('openai/gpt-4o-mini',            'openai',     0.1500,  0.6000, 'OpenAI fast/cheap tier'),
  ('google/gemini-2.5-pro',         'google',     1.2500,  5.0000, 'Google long-context flagship (1M context)'),
  ('google/gemini-2.5-flash',       'google',     0.0750,  0.3000, 'Google fast/cheap tier')
ON CONFLICT (model) DO NOTHING;

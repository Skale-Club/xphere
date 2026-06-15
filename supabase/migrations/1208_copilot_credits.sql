-- Migration 1208: Copilot credit wallet (per org)
--
-- The paid plans include a monthly Copilot credit allowance; when it runs out the
-- org can buy more (one-time top-ups). This models that as TWO buckets in one row:
--   included_balance_usd — the monthly allowance remaining. RESET (set, not added)
--                          at the start of each billing period; unused credits do
--                          NOT roll over.
--   topup_balance_usd     — credits bought à la carte (or granted by the agency).
--                          These PERSIST across resets.
-- Spendable balance = included_balance_usd + topup_balance_usd. Debits consume the
-- included bucket first, then top-ups.
--
-- Accounting unit is USD with micro precision, matching copilot_runs.estimated_cost_usd
-- (the real cost). The UI presents it as round "credits" (see CREDIT_USD_RATE).
--
-- All writes go through the SECURITY DEFINER RPCs below (atomic: row lock + balance
-- update + ledger insert in one statement), which are granted to service_role only.
-- Members get read-only RLS visibility into their own org's wallet + history.

-- ─── balances ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.copilot_credit_balances (
  org_id                uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  included_balance_usd  numeric(12,6) NOT NULL DEFAULT 0,   -- monthly allowance remaining (resets)
  topup_balance_usd     numeric(12,6) NOT NULL DEFAULT 0,   -- purchased/granted (persists)
  included_allowance_usd numeric(10,4) NOT NULL DEFAULT 0,  -- the plan's monthly allowance (what a reset sets)
  period_end            timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.copilot_credit_balances IS
  'Per-org Copilot credit wallet. included_* resets monthly; topup_* persists. Spendable = included_balance_usd + topup_balance_usd.';

ALTER TABLE public.copilot_credit_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "copilot_credit_balances_org_read" ON public.copilot_credit_balances;
CREATE POLICY "copilot_credit_balances_org_read"
  ON public.copilot_credit_balances
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_copilot_credit_balances_updated_at ON public.copilot_credit_balances;
CREATE TRIGGER trg_copilot_credit_balances_updated_at
  BEFORE UPDATE ON public.copilot_credit_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── ledger (auditable history) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.copilot_credit_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('monthly_reset','topup','grant','debit')),
  amount_usd     numeric(12,6) NOT NULL,        -- signed: negative for debit
  balance_after  numeric(12,6) NOT NULL,        -- total spendable after the op
  copilot_run_id uuid REFERENCES public.copilot_runs(id) ON DELETE SET NULL,
  stripe_ref     text,                          -- payment_intent / invoice id
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.copilot_credit_ledger IS
  'Append-only Copilot credit transactions for audit. Service-role write only.';

CREATE INDEX IF NOT EXISTS idx_copilot_credit_ledger_org_created
  ON public.copilot_credit_ledger (org_id, created_at DESC);

ALTER TABLE public.copilot_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "copilot_credit_ledger_org_read" ON public.copilot_credit_ledger;
CREATE POLICY "copilot_credit_ledger_org_read"
  ON public.copilot_credit_ledger
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ─── RPC: debit (cost already incurred — always applies, may go negative) ─────
-- Consumes the included bucket first, then top-ups. The PRE-check gates the NEXT
-- turn; we never refuse to record a cost that already happened.
CREATE OR REPLACE FUNCTION public.debit_copilot_credits(
  p_org_id uuid,
  p_amount_usd numeric,
  p_run_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inc numeric;
  v_top numeric;
  v_take_inc numeric;
  v_total numeric;
BEGIN
  IF p_amount_usd IS NULL OR p_amount_usd < 0 THEN
    RAISE EXCEPTION 'debit amount must be >= 0';
  END IF;

  INSERT INTO public.copilot_credit_balances (org_id)
    VALUES (p_org_id)
    ON CONFLICT (org_id) DO NOTHING;

  SELECT included_balance_usd, topup_balance_usd
    INTO v_inc, v_top
    FROM public.copilot_credit_balances
    WHERE org_id = p_org_id
    FOR UPDATE;

  -- Take from included first (only the positive portion), remainder from top-ups.
  v_take_inc := greatest(0, least(v_inc, p_amount_usd));
  v_inc := v_inc - v_take_inc;
  v_top := v_top - (p_amount_usd - v_take_inc);
  v_total := v_inc + v_top;

  UPDATE public.copilot_credit_balances
    SET included_balance_usd = v_inc,
        topup_balance_usd = v_top,
        updated_at = now()
    WHERE org_id = p_org_id;

  INSERT INTO public.copilot_credit_ledger (org_id, kind, amount_usd, balance_after, copilot_run_id)
    VALUES (p_org_id, 'debit', -p_amount_usd, v_total, p_run_id);

  RETURN jsonb_build_object('allowed', v_total > 0, 'balance_after', v_total);
END $$;

-- ─── RPC: credit (top-up / grant — adds to the persistent bucket) ─────────────
CREATE OR REPLACE FUNCTION public.credit_copilot_credits(
  p_org_id uuid,
  p_amount_usd numeric,
  p_kind text,
  p_ref text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_amount_usd IS NULL OR p_amount_usd < 0 THEN
    RAISE EXCEPTION 'credit amount must be >= 0';
  END IF;
  IF p_kind NOT IN ('topup','grant') THEN
    RAISE EXCEPTION 'invalid credit kind: %', p_kind;
  END IF;

  INSERT INTO public.copilot_credit_balances (org_id, topup_balance_usd)
    VALUES (p_org_id, p_amount_usd)
    ON CONFLICT (org_id) DO UPDATE
      SET topup_balance_usd = public.copilot_credit_balances.topup_balance_usd + EXCLUDED.topup_balance_usd,
          updated_at = now();

  SELECT included_balance_usd + topup_balance_usd INTO v_total
    FROM public.copilot_credit_balances WHERE org_id = p_org_id;

  INSERT INTO public.copilot_credit_ledger (org_id, kind, amount_usd, balance_after, stripe_ref, note)
    VALUES (p_org_id, p_kind, p_amount_usd, v_total, p_ref, p_note);

  RETURN v_total;
END $$;

-- ─── RPC: reset (start of billing period — SET the monthly allowance) ─────────
-- Sets the included bucket to the plan allowance (no roll-over). Top-ups untouched.
CREATE OR REPLACE FUNCTION public.reset_copilot_credits(
  p_org_id uuid,
  p_included_usd numeric,
  p_period_end timestamptz DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_included_usd IS NULL OR p_included_usd < 0 THEN
    RAISE EXCEPTION 'included amount must be >= 0';
  END IF;

  INSERT INTO public.copilot_credit_balances (org_id, included_balance_usd, included_allowance_usd, period_end)
    VALUES (p_org_id, p_included_usd, p_included_usd, p_period_end)
  ON CONFLICT (org_id) DO UPDATE
    SET included_balance_usd = EXCLUDED.included_balance_usd,
        included_allowance_usd = EXCLUDED.included_allowance_usd,
        period_end = EXCLUDED.period_end,
        updated_at = now();

  SELECT included_balance_usd + topup_balance_usd INTO v_total
    FROM public.copilot_credit_balances WHERE org_id = p_org_id;

  INSERT INTO public.copilot_credit_ledger (org_id, kind, amount_usd, balance_after, note)
    VALUES (p_org_id, 'monthly_reset', p_included_usd, v_total, 'period allowance refresh');

  RETURN v_total;
END $$;

-- Lock the wallet RPCs down to trusted backend code (service_role) only.
-- NOTE: REVOKE FROM PUBLIC alone is NOT enough on Supabase — default privileges
-- grant EXECUTE to anon/authenticated on new public functions, and those explicit
-- grants survive a PUBLIC revoke. Revoke from them by name too, or these
-- SECURITY DEFINER wallet RPCs become callable over REST by any user.
REVOKE ALL ON FUNCTION public.debit_copilot_credits(uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_copilot_credits(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_copilot_credits(uuid, numeric, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_copilot_credits(uuid, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_copilot_credits(uuid, numeric, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_copilot_credits(uuid, numeric, timestamptz) TO service_role;

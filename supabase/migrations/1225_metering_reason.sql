-- Migration 1225: Generic metering reason tag on the Copilot credit ledger
--
-- Phase 114 (Metering Architecture) consolidates Copilot's credit debit path
-- into a single, generic, reason-tagged interface (`meterDebit()` in
-- src/lib/billing/credits.ts) that future features (workflows, campaigns,
-- calls) can plug into later without redesign. This migration adds the
-- ledger-side half of that: a nullable `reason` column recording which
-- feature triggered each debit, and threads a new `p_reason` parameter
-- through `debit_copilot_credits` so the RPC can populate it.
--
-- Scope note: only the DEBIT RPC gains this parameter. `credit_copilot_credits`
-- and `reset_copilot_credits` are administrative operations (top-up/grant/
-- period reset) that already self-describe via `kind`/`stripe_ref`/`note` —
-- out of scope for this phase (see 114-RESEARCH.md Pitfall 3).

-- ─── ledger: add reason tag column ───────────────────────────────────────────
ALTER TABLE public.copilot_credit_ledger
  ADD COLUMN IF NOT EXISTS reason text;

COMMENT ON COLUMN public.copilot_credit_ledger.reason IS
  'Feature/reason tag for this ledger entry (e.g. copilot_turn, future workflow_run). Populated by the generic metering debit interface (src/lib/billing/credits.ts meterDebit). NULL for grant/reset/topup rows and for any pre-migration debit rows.';

-- ─── RPC: debit — gains p_reason, threaded into the ledger insert ────────────
-- Entire function body reproduced unchanged except the new trailing param and
-- its pass-through into the ledger row; draw-down logic, FOR UPDATE row lock,
-- exception check, and return shape are untouched.
CREATE OR REPLACE FUNCTION public.debit_copilot_credits(
  p_org_id uuid,
  p_amount_usd numeric,
  p_run_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
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

  v_take_inc := greatest(0, least(v_inc, p_amount_usd));
  v_inc := v_inc - v_take_inc;
  v_top := v_top - (p_amount_usd - v_take_inc);
  v_total := v_inc + v_top;

  UPDATE public.copilot_credit_balances
    SET included_balance_usd = v_inc,
        topup_balance_usd = v_top,
        updated_at = now()
    WHERE org_id = p_org_id;

  INSERT INTO public.copilot_credit_ledger (org_id, kind, amount_usd, balance_after, copilot_run_id, reason)
    VALUES (p_org_id, 'debit', -p_amount_usd, v_total, p_run_id, p_reason);

  RETURN jsonb_build_object('allowed', v_total > 0, 'balance_after', v_total);
END $$;

-- Re-issue grants against the NEW 4-arg signature. Postgres does not carry
-- these grants forward across a signature-changing CREATE OR REPLACE FUNCTION —
-- the old 3-arg overload's grant entry is orphaned once nothing calls it.
REVOKE ALL ON FUNCTION public.debit_copilot_credits(uuid, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_copilot_credits(uuid, numeric, uuid, text) TO service_role;

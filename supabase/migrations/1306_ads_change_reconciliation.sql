-- =============================================================================
-- Migration 1306: Ads change reconciliation (external drift detection)
-- =============================================================================
-- A change the engine applied and verified can later be undone or altered
-- outside Xphere (Google Ads UI, Meta Ads Manager, another tool). The worker
-- re-reads recently applied changes and records when the platform no longer
-- matches what Xphere set. The change's status is NOT rewritten — it did
-- succeed; the drift is a separate fact about what happened afterwards.
--
-- Idempotent.
-- =============================================================================

ALTER TABLE public.ads_change_requests
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_drift JSONB,
  ADD COLUMN IF NOT EXISTS external_drift_detected_at TIMESTAMPTZ;

-- The reconciler's scan: applied changes, oldest check first.
CREATE INDEX IF NOT EXISTS ads_change_requests_reconcile
  ON public.ads_change_requests (last_reconciled_at NULLS FIRST, completed_at)
  WHERE status = 'succeeded';

-- Circuit breaker lookup: recent failures per account.
CREATE INDEX IF NOT EXISTS ads_change_requests_account_errors
  ON public.ads_change_requests (org_id, platform, ad_account_id, updated_at DESC)
  WHERE error_code IS NOT NULL;

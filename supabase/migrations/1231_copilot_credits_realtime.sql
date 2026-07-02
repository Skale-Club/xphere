-- Migration 1226: Enable Realtime for the Copilot credit balance indicator
-- Adds copilot_credit_balances to the supabase_realtime publication so the
-- TopBar CreditsIndicator can subscribe via postgres_changes and reflect
-- balance changes (debits, top-ups, monthly resets) live, without a page
-- reload (CRB-02). Idempotent: wraps the ALTER in a DO block that swallows
-- duplicate_object errors, matching migrations 024 and 1206.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_credit_balances;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- Migration: 1218_org_daily_cost_cap_enabled
-- Adds:    organizations.daily_cost_cap_enabled BOOLEAN NOT NULL DEFAULT true
-- Why:     The daily AI cost cap previously had only two states on
--          daily_cost_cap_usd_override: NULL (platform default) or a number
--          (custom cap). There was no way to DISABLE the cap entirely. This adds
--          an explicit on/off switch, surfaced in Settings → Billing.
--
--          daily_cost_cap_enabled = true  -> cap enforced (override value, or the
--                                            AGENT_DAILY_COST_CAP_USD platform default
--                                            when daily_cost_cap_usd_override IS NULL).
--          daily_cost_cap_enabled = false -> NO cap; agents may spend without limit.
--
--          Default true preserves the existing always-enforced behavior for all
--          current orgs. Enforced by guardrails.ts checkDailyCostCap().
-- No RLS change: organizations table RLS from 001_foundation already covers this column.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS daily_cost_cap_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.daily_cost_cap_enabled IS
  'On/off switch for the per-org daily agent cost cap. true = enforce cap (uses daily_cost_cap_usd_override, or AGENT_DAILY_COST_CAP_USD env default when NULL). false = no cap, unlimited agent spend. Enforced by the agent runtime guardrails.ts checkDailyCostCap().';

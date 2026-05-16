-- =============================================================================
-- Migration: 042_org_daily_cost_cap
-- Phase: v2.0 Phase 34 — Agent Runtime Skeleton + Day-1 Guardrails
-- Adds:    agent_invocation_status enum value 'running'
--          organizations.daily_cost_cap_usd_override NUMERIC(8,2) NULL
-- Decisions: D-34-03 (running status for INSERT-at-start), D-34-05 (per-org cost cap)
-- No RLS change: organizations table RLS from 001_foundation already covers this column.
-- No UI in Phase 34: set via direct DB edit or Phase 36 settings panel.
-- =============================================================================

-- Add 'running' to agent_invocation_status enum.
-- Required so invocations.ts can INSERT with status='running' at invocation start (D-34-03).
-- Orphaned rows (status='running', duration_ms IS NULL, created_at > 10s ago) are detected
-- by Phase 40 observability queries.
ALTER TYPE public.agent_invocation_status ADD VALUE IF NOT EXISTS 'running';

-- Add per-org daily cost cap override column.
-- NULL  -> runtime uses AGENT_DAILY_COST_CAP_USD env var (default $50.00).
-- Non-null -> runtime uses this org-specific cap.
-- Enforced by guardrails.ts checkDailyCostCap() before each invocation.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS daily_cost_cap_usd_override NUMERIC(8,2) NULL;

COMMENT ON COLUMN public.organizations.daily_cost_cap_usd_override IS
  'Phase 34 (v2.0): per-org daily agent cost cap override in USD. NULL = use AGENT_DAILY_COST_CAP_USD env var (default $50.00). Non-null = use this org-specific cap. Enforced by the agent runtime guardrails.ts before each invocation.';

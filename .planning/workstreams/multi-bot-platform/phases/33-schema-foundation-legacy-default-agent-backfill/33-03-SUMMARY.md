---
phase: 33-schema-foundation-legacy-default-agent-backfill
plan: 03
subsystem: schema-foundation
tags: [migrations, agents, observability, rls, schema, additive]
requirements: [OBS-01, OBS-02]
dependency_graph:
  requires:
    - 34-agents-table (33-02)
    - 1-foundation (organizations, get_current_org_id, update_updated_at)
    - 2-action-engine (action_logs being ALTERed additively)
  provides:
    - agent_channel_defaults table (resolver mapping)
    - agent_invocations table (observability sink)
    - agent_invocation_status enum
    - agent_invocation_mode enum
    - action_logs.agent_invocation_id (additive nullable FK)
    - action_logs.trace_id (additive nullable)
  affects:
    - supabase/migrations/ (added 036, 037)
tech_stack:
  added:
    - PostgreSQL ENUM type (agent_invocation_status, agent_invocation_mode)
  patterns:
    - canonical RLS template (SELECT public.get_current_org_id())
    - idempotent migrations (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE TYPE in DO blocks)
    - additive-only schema evolution on action_logs (no breaking changes for Vapi consumers)
    - partial index pattern (parent_invocation_id, trace_id where NOT NULL)
key_files:
  created:
    - supabase/migrations/036_agent_channel_defaults.sql
    - supabase/migrations/037_agent_invocations.sql
  modified: []
decisions:
  - "Honored D-33-13: shipped exactly 4 mandatory indexes on agent_invocations"
  - "Honored D-33-17: status enum has all 5 values (success | error | aborted | skipped | denied)"
  - "Honored D-33-18: mode enum has both values (production | playground)"
  - "Used partial indexes (WHERE col IS NOT NULL) for parent_invocation_id and action_logs.trace_id to keep them lean"
  - "agent_invocations.conversation_id intentionally UUID with NO FK to conversations(id) to avoid circular dependency with Phase 35 (conversations.agent_id added then)"
  - "RLS on agent_invocations is SELECT-only for authenticated; runtime (Phase 34) writes via service-role client bypassing RLS"
metrics:
  duration: "~5min"
  completed: "2026-05-15"
  tasks: 2
  files_created: 2
  files_modified: 0
  commits: 2
---

# Phase 33 Plan 03: Migrations 036 (agent_channel_defaults) + 037 (agent_invocations) Summary

Shipped the agent resolver mapping table (`agent_channel_defaults`) and the day-1 observability table (`agent_invocations`) with both status/mode enums, all 4 mandatory D-33-13 indexes, and the additive `agent_invocation_id` + `trace_id` columns on `action_logs` (OBS-02) — Vapi paths untouched.

## What Was Built

### Migration 036 — `agent_channel_defaults`
- Table: `(id, organization_id, channel, agent_id, created_at, updated_at)`
- `UNIQUE (organization_id, channel)` — enforces one default agent per (org, channel) and gives Phase 34's `resolveAgentForChannel(orgId, channel)` a sub-ms lookup
- FK to `agents(id) ON DELETE CASCADE`
- Uses `public.agent_channel` enum (defined in Plan 02's migration 034)
- RLS: canonical `(organization_id = (SELECT public.get_current_org_id()))` for FOR ALL TO authenticated
- `updated_at` trigger using shared `public.update_updated_at()`
- Idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS`)

### Migration 037 — `agent_invocations` (OBS-01) + `action_logs` additive (OBS-02)

**Enums (DO blocks, idempotent):**
- `public.agent_invocation_status`: `success | error | aborted | skipped | denied` (D-33-17)
- `public.agent_invocation_mode`: `production | playground` (D-33-18)

**Table `public.agent_invocations`** with the OBS-01 column set:
- Identity: `id`, `organization_id` (FK + RLS), `agent_id` (FK CASCADE)
- Tree: `parent_invocation_id` (self-FK, `ON DELETE SET NULL`), `trace_id UUID NOT NULL`, `depth INT DEFAULT 0`
- Context: `channel` (agent_channel enum), `conversation_id UUID` (no FK — circular-dependency avoidance for Phase 35), `session_id TEXT`
- Outcome: `status`, `mode DEFAULT 'production'`, `user_message`, `assistant_reply`
- Telemetry: `tool_calls JSONB`, `partner_calls JSONB`, `tokens_in`, `tokens_out`, `cost_usd NUMERIC(10,6)`, `model`, `duration_ms`, `error_detail`
- `created_at TIMESTAMPTZ DEFAULT now()`

**4 mandatory indexes per D-33-13:**
1. `idx_agent_invocations_org_created (organization_id, created_at DESC)` — dashboard list
2. `idx_agent_invocations_trace (trace_id)` — cross-table joins
3. `idx_agent_invocations_parent (parent_invocation_id) WHERE NOT NULL` — delegation tree
4. `idx_agent_invocations_agent_created (agent_id, created_at DESC)` — per-agent metrics

**RLS:** SELECT-only for `authenticated` (read for dashboard); writes are service-role only (Phase 34 runtime bypasses RLS via service-role client).

**action_logs additive (OBS-02):**
- `agent_invocation_id UUID REFERENCES agent_invocations(id) ON DELETE SET NULL` (nullable — `NULL` = legacy v1.x Vapi action)
- `trace_id UUID` (nullable — cross-table correlation)
- `idx_action_logs_trace (trace_id) WHERE NOT NULL` — partial index for the trace join (D-33-14)
- Two `COMMENT ON COLUMN` rows for self-documentation
- **No DROP / no RENAME** — additive only, Vapi consumers continue to read existing columns without change.

## Tasks Executed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Migration 036 agent_channel_defaults | `1776b5b` | supabase/migrations/036_agent_channel_defaults.sql |
| 2 | Migration 037 agent_invocations + action_logs additive | `05d5343` | supabase/migrations/037_agent_invocations.sql |

## Verification Results

Migration 036 (all acceptance criteria passed):
- File exists, contains `CREATE TABLE IF NOT EXISTS public.agent_channel_defaults` (1)
- `UNIQUE (organization_id, channel)` (1)
- `REFERENCES public.agents(id) ON DELETE CASCADE` (1)
- `public.agent_channel` references (10 — type used in column + index + comment etc.)
- `ENABLE ROW LEVEL SECURITY` (1), canonical USING pattern (1)
- `EXECUTE FUNCTION public.update_updated_at` (1)
- DROP TABLE/RENAME: 0

Migration 037 (all acceptance criteria passed):
- `CREATE TABLE IF NOT EXISTS public.agent_invocations` (1)
- `CREATE TYPE public.agent_invocation_status` (1), `CREATE TYPE public.agent_invocation_mode` (1)
- Status enum has all 5 values literal match (1); mode enum has both values (1)
- All 4 indexes present (1 each)
- `trace_id UUID NOT NULL` (1)
- `parent_invocation_id UUID` (1); `REFERENCES public.agent_invocations(id) ON DELETE SET NULL` (2 — also reused by action_logs.agent_invocation_id, both correct)
- `FOR SELECT TO authenticated` (1); `FOR INSERT TO authenticated` (0) — confirms SELECT-only
- `ADD COLUMN IF NOT EXISTS agent_invocation_id` (1), `ADD COLUMN IF NOT EXISTS trace_id` (1)
- `idx_action_logs_trace` (1)
- DROP TABLE/RENAME: 0

## Deviations from Plan

None — plan executed exactly as written. SQL files match the plan's copy-paste blocks verbatim.

## Authentication Gates

None — file-only changes, no external services touched.

## Known Stubs

None. Both files are complete, idempotent migrations ready for Plan 06 to push.

## Downstream Impact

- **Plan 05 (seed) — depends on this plan:** Will INSERT `agent_channel_defaults(org_id, 'web_widget', main_agent_id)` per D-33-09 backfill.
- **Plan 06 (push) — depends on this plan:** Will run `npx supabase db push` to apply 034, 035, 036, 037, 038, 039 together.
- **Phase 34 — depends on this plan:** `resolveAgentForChannel(orgId, channel)` reads from `agent_channel_defaults`; runtime INSERTs into `agent_invocations` on every `runAgent()` call; tool executors set `action_logs.agent_invocation_id` + `trace_id` for cross-table trace correlation.
- **Phase 35 — depends on this plan:** Web widget cutover writes `agent_invocations` rows + correlates with `action_logs.trace_id`; backfill GATE-07 expects `agent_channel_defaults` row with channel = 'web_widget' per org.
- **Phase 40 — depends on this plan:** Observability dashboard queries the 4 D-33-13 indexes for org list, trace correlation, delegation tree, and per-agent metrics.

## Self-Check: PASSED

Files verified on disk:
- FOUND: supabase/migrations/036_agent_channel_defaults.sql
- FOUND: supabase/migrations/037_agent_invocations.sql

Commits verified in git log:
- FOUND: 1776b5b (Task 1)
- FOUND: 05d5343 (Task 2)

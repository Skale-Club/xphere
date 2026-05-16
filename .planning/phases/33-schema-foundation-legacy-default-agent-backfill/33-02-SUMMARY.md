---
phase: 33-schema-foundation-legacy-default-agent-backfill
plan: 02
subsystem: schema-foundation
tags: [migration, agents, rls, schema, v2.0]
requires:
  - supabase/migrations/001_foundation.sql (organizations, get_current_org_id, update_updated_at)
  - supabase/migrations/002_action_engine.sql (tool_configs)
provides:
  - public.agent_channel enum
  - public.agents table (org-scoped, RLS, audit fields)
  - public.agent_tools junction (TOOL-01)
  - public.agent_partners directed-edge junction (DELEG-01)
  - public.agent_prompt_versions table (versioned prompt history)
  - public.agents.active_prompt_version_id nullable FK
affects:
  - supabase/migrations/ (adds 034 + 035; no edits to prior migrations)
tech-stack:
  added: []
  patterns:
    - canonical RLS via (SELECT public.get_current_org_id())
    - idempotent migrations (CREATE TABLE IF NOT EXISTS, DO-block enum guard)
    - append-only audit (created_by/updated_by, created_at/updated_at)
key-files:
  created:
    - supabase/migrations/034_agents.sql
    - supabase/migrations/035_agent_prompt_versions.sql
  modified: []
decisions:
  - D-33-19 applied: agent_channel enum has all 6 channel values (web_widget, whatsapp, messenger, instagram, manychat, telegram)
  - D-33-02 applied: every RLS policy uses (SELECT public.get_current_org_id()) wrapper
  - D-33-06 applied: agents.active_prompt_version_id is nullable FK to agent_prompt_versions(id); seed migration (Plan 06) resolves the chicken-and-egg cycle via INSERT-then-UPDATE
  - D-33-16 applied: NO auto-snapshot trigger on agents.system_prompt UPDATE in this migration — deferred to Phase 41
metrics:
  duration_minutes: 4
  tasks_completed: 2
  commits: 2
  files_created: 2
  completed_date: 2026-05-15
---

# Phase 33 Plan 02: Wave 2 — Migrations 034 + 035 Summary

**One-liner:** Schema-only Postgres migrations that create the agents entity (`public.agents`), its TOOL-01/DELEG-01 junction tables (`agent_tools`, `agent_partners`), the `agent_channel` enum, and the versioned-prompt store (`agent_prompt_versions` + nullable back-pointer `agents.active_prompt_version_id`) — all RLS-enabled with the canonical `get_current_org_id()` template and fully additive (no DROP/RENAME).

## What Was Built

### Migration 034 — `034_agents.sql`

- **Enum** `public.agent_channel` (6 values: web_widget, whatsapp, messenger, instagram, manychat, telegram) created via DO-block existence guard.
- **Table** `public.agents`:
  - PK `id` UUID, org-scoped `organization_id` FK CASCADE
  - Identity: `name`, `slug` (UNIQUE per org), `description`
  - LLM config: `system_prompt`, `model` (default `anthropic/claude-haiku-4-5`), `fallback_message`, `max_history`
  - Scoping: `kb_scope` TEXT[], `channel_overrides` JSONB, `allowed_channels` `agent_channel[]` default `['web_widget']`
  - Lifecycle: `is_active` BOOLEAN default true
  - Audit (AGENT-09): `created_by`, `updated_by` (FK auth.users SET NULL), `created_at`, `updated_at`
  - Indexes: `(org, is_active)`, `(org, slug)`
  - 4 explicit RLS policies (SELECT/INSERT/UPDATE/DELETE), `trg_agents_updated_at` trigger
- **Table** `public.agent_tools` (TOOL-01 junction): UNIQUE `(agent_id, tool_config_id)`; nullable `allowed_channels` (NULL = all); FOR ALL RLS
- **Table** `public.agent_partners` (DELEG-01 directed edge): CHECK `agent_id <> partner_agent_id`, UNIQUE pair, `invocation_description` NOT NULL; FOR ALL RLS

### Migration 035 — `035_agent_prompt_versions.sql`

- **Table** `public.agent_prompt_versions`: PK UUID, org-scoped, FK to `agents(id)` CASCADE, monotonic `version` INTEGER, `system_prompt` TEXT, `created_by`, `created_at`; UNIQUE `(agent_id, version)`, CHECK `version >= 1`; index `(agent_id, version DESC)`; FOR ALL RLS
- **ALTER** `public.agents ADD COLUMN IF NOT EXISTS active_prompt_version_id UUID REFERENCES agent_prompt_versions(id) ON DELETE SET NULL` — nullable to resolve the FK chicken-and-egg cycle at seed time (D-33-06)
- Partial index `idx_agents_active_prompt_version` WHERE NOT NULL
- **No auto-snapshot trigger** on `agents.system_prompt` UPDATE — explicitly deferred to Phase 41 per D-33-16

## Acceptance Criteria

Both migrations pass every `grep`-based acceptance check from the plan:

- 034: 3 `CREATE TABLE IF NOT EXISTS`, 1 enum DO-block, 3 `ENABLE ROW LEVEL SECURITY`, 5 canonical USING clauses (matches 4 explicit policies on agents + 1 FOR ALL on each junction = 5), CHECK on self-loop, trigger reuses `public.update_updated_at()`, 0 DROP TABLE / 0 RENAME.
- 035: 1 `CREATE TABLE IF NOT EXISTS`, 1 `ADD COLUMN IF NOT EXISTS`, both FK directions present, UNIQUE + CHECK constraints present, 1 RLS policy, 0 triggers (D-33-16), 0 DROP/RENAME.

## Deviations from Plan

None — plan executed exactly as written. Both migrations were copied verbatim from the plan body, written via the Write tool, and verified by the plan's own `grep` acceptance commands.

## Authentication Gates

None encountered — no remote work performed. Migrations are intentionally NOT pushed in this plan (Plan 06 owns `npx supabase db push`).

## Commits

| Task | Commit  | Files                                             |
| ---- | ------- | ------------------------------------------------- |
| 1    | 6e2931e | supabase/migrations/034_agents.sql                |
| 2    | 181709c | supabase/migrations/035_agent_prompt_versions.sql |

(Each commit uses `--no-verify` per Wave 2 parallel-execution protocol; the orchestrator runs hooks once after all Wave 2 agents complete.)

## Downstream Impact

- **Plan 03 (Wave 2)** writes migration 037 `agent_invocations` and ALTERs `action_logs` — references `agents.id` for FK; safe to proceed in parallel because Plan 03's FK targets are now declared.
- **Plan 04 (Wave 2)** writes migrations 036 + 038 + 039 — `agent_channel_defaults` FKs `agents.id`; `manychat_rules.agent_id` and `meta_channels.agent_id` columns reference `agents.id`. Same parallel safety.
- **Plan 06 (Wave 3, seed)** INSERTs into `agents` + `agent_prompt_versions`, then UPDATEs `agents.active_prompt_version_id` to resolve the FK cycle (D-33-06).
- **Plan 07 (Wave 4, push)** runs `npx supabase db push` to apply all 6 migrations remotely — that's when the Plan 01 RED smoke tests flip GREEN.

## Known Stubs

None. These are pure DDL migrations — no UI, no runtime, no placeholder data.

## Self-Check: PASSED

- File supabase/migrations/034_agents.sql — FOUND
- File supabase/migrations/035_agent_prompt_versions.sql — FOUND
- Commit 6e2931e — FOUND
- Commit 181709c — FOUND

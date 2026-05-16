---
phase: 33-schema-foundation-legacy-default-agent-backfill
plan: 05
subsystem: schema/channel-dispatch
tags: [migration, channel, agent, chan-06, additive]
requirements_addressed: [CHAN-06]
dependency_graph:
  requires:
    - public.agents table (migration 034 from Plan 02 — sibling Wave 2)
    - public.manychat_rules table (migration 027, v1.x)
    - public.meta_channels table (migration 019, v1.x)
  provides:
    - public.manychat_rules.agent_id (nullable FK to public.agents)
    - public.meta_channels.agent_id (nullable FK to public.agents)
    - idx_manychat_rules_agent_id (partial index)
    - idx_meta_channels_agent_id (partial index)
  affects:
    - Phase 36 channel CRUD UI: can now read/write agent_id on rules + channels
    - Phase 37 inbound dispatcher: will branch on agent_id IS NOT NULL to call runAgent() vs legacy tool_config_id path
tech-stack:
  added: []
  patterns:
    - "Additive ALTER TABLE ADD COLUMN IF NOT EXISTS (idempotent)"
    - "Partial index WHERE agent_id IS NOT NULL (sub-ms lookup despite mostly-NULL column)"
    - "FK ON DELETE SET NULL (deleting agent leaves rule/channel row intact, falls back to legacy dispatch)"
key-files:
  created:
    - supabase/migrations/039_channel_agent_id_columns.sql
  modified: []
decisions:
  - "D-33-11 honored: NO backfill UPDATE statements — existing manychat_rules + meta_channels rows keep agent_id IS NULL, preserving byte-identical v1.x dispatch via tool_config_id"
  - "D-33-12 honored: NO XOR CHECK constraint between agent_id and tool_config_id — deferred to Phase 37 where the dispatcher branches on the column"
  - "Partial indexes (WHERE agent_id IS NOT NULL) chosen over full indexes since the vast majority of rows will remain NULL until Phase 36 admin opt-in; partial index keeps dispatcher lookups sub-ms while costing near-zero storage"
  - "RLS not re-enabled — both tables already have ENABLE ROW LEVEL SECURITY from origin migrations (027 and 019); adding it again would be a no-op but the migration explicitly skips it to keep diff minimal and self-documenting"
metrics:
  duration_minutes: 3
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  commits: 1
  completed_date: 2026-05-15
---

# Phase 33 Plan 05: Migration 039 — Channel agent_id Columns Summary

One-liner: Additive nullable `agent_id UUID FK` column added to both `public.manychat_rules` and `public.meta_channels` with partial indexes, enabling Phase 37's inbound dispatcher to branch between v2.0 agents and legacy v1.x tool_config_id dispatch without touching existing rows.

## What Was Built

A single 44-line SQL migration (`supabase/migrations/039_channel_agent_id_columns.sql`) that:

1. **`public.manychat_rules`** — adds nullable `agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL`; creates partial index `idx_manychat_rules_agent_id WHERE agent_id IS NOT NULL`; documents NULL semantics via `COMMENT ON COLUMN`.
2. **`public.meta_channels`** — same pattern: nullable FK to `public.agents(id)`, partial index, COMMENT.

The migration is fully additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). It does NOT:

- Backfill any existing rows (per D-33-11)
- Add a CHECK constraint enforcing XOR between `agent_id` and `tool_config_id` (deferred to Phase 37 per D-33-12)
- Re-enable RLS (both tables already RLS-enabled in origin migrations 027 / 019)
- DROP or RENAME anything

## Pre-flight Verification Performed

Before writing the migration, confirmed via Grep:

- `public.manychat_rules` table defined in `supabase/migrations/027_manychat_rules.sql:13` with `ENABLE ROW LEVEL SECURITY` at line 26 — confirmed `agent_id` column does NOT already exist
- `public.meta_channels` table defined in `supabase/migrations/019_meta_channels.sql:14` with `ENABLE ROW LEVEL SECURITY` at line 37 — confirmed `agent_id` column does NOT already exist
- `supabase/migrations/034_agents.sql` exists (FK target) — Wave 2 sibling plan landing in parallel

## Acceptance Criteria Results

| Criterion | Expected | Actual | Pass |
| --- | --- | --- | --- |
| File exists | yes | yes | yes |
| `ALTER TABLE public.manychat_rules` count | 1 | 1 | yes |
| `ALTER TABLE public.meta_channels` count | 1 | 1 | yes |
| `ADD COLUMN IF NOT EXISTS agent_id` count | 2 | 2 | yes |
| `REFERENCES public.agents(id) ON DELETE SET NULL` count | 2 | 2 | yes |
| `WHERE agent_id IS NOT NULL` count | >= 2 | 3 | yes (2 in indexes + 1 reuse in column comment) |
| `UPDATE public.` (backfill) count | 0 | 0 | yes (D-33-11) |
| `ADD CONSTRAINT...CHECK` count | 0 | 0 | yes (D-33-12) |
| `ENABLE ROW LEVEL SECURITY` count | 0 | 0 | yes (RLS already enabled in origin migrations) |
| `COMMENT ON COLUMN` count | 2 | 2 | yes |
| `CHAN-06` mentions | >= 2 | 3 | yes (header + 2 column comments) |
| `D-33-12` mentions | >= 2 | 4 | yes (header summary + each comment) |
| `DROP TABLE` / `RENAME` count | 0 | 0 | yes |

All 13 acceptance criteria pass.

## Deviations from Plan

None — plan executed exactly as written. The pre-flight check found both target tables in the expected migrations (027, 019) with the exact `public.` schema names; no surprises.

## Commits

| Commit | Type | Message |
| --- | --- | --- |
| `c4cf67d` | feat | feat(33-05): add migration 039 channel agent_id columns (CHAN-06) |

Commit made with `--no-verify` per Wave 2 parallel-execution coordination (avoiding pre-commit hook contention with sibling plans 33-02 / 33-03 / 33-04 committing concurrently).

## What's Next

- **Plan 06 (33-06):** Seed migration 040 — creates Main Agent + prompt version + tool grants + web_widget channel default for every existing org. Does NOT depend on this plan.
- **Plan 07 (33-07):** Checkpoint — operator runs `npx supabase db push` to apply migrations 034-040, then executor regenerates `src/types/database.ts`.
- **Phase 36:** Admin dashboard will allow opting individual `manychat_rules` and `meta_channels` rows into v2.0 agents by writing to the column added here.
- **Phase 37:** Inbound dispatcher will read this column and branch: `agent_id IS NOT NULL` → call `runAgent(agent_id)`; `agent_id IS NULL` → legacy v1.x dispatch via `tool_config_id` (unchanged byte-for-byte).

## Self-Check: PASSED

- File exists: `supabase/migrations/039_channel_agent_id_columns.sql` — verified via `test -f` (output: "FILE EXISTS")
- Commit exists: `c4cf67d` — committed successfully (`git commit` output: `[main c4cf67d] feat(33-05): add migration 039 channel agent_id columns (CHAN-06) 1 file changed, 44 insertions(+)`)
- Pre-flight tables confirmed: `public.manychat_rules` (027:13), `public.meta_channels` (019:14)
- FK target confirmed: `supabase/migrations/034_agents.sql` exists (Plan 02 Wave 2 sibling)
- All 13 acceptance criteria verified passing

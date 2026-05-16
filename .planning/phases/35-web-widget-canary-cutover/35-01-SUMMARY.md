---
phase: 35-web-widget-canary-cutover
plan: "01"
subsystem: schema.conversations.agent_id
tags: [schema, migration, types-regen, gate-07, gate-01, conversations, agent_id]
dependency_graph:
  requires: [33-07, 34-06]
  provides: [migration-043-applied, conversations.agent_id-typed, GATE-07-complete]
  affects: [phase-35-02, phase-35-03, phase-35-04]
tech_stack:
  added: []
  patterns:
    - "Manual database.ts extension (CLI access-tier limitation blocks supabase gen types --linked)"
    - "Checkpoint plan: Task 1 (write SQL) → human push → Task 2 (types update + build)"
key_files:
  created:
    - supabase/migrations/043_conversations_agent_id.sql
    - .planning/phases/35-web-widget-canary-cutover/35-01-SUMMARY.md
  modified:
    - src/types/database.ts
decisions:
  - "agent_id is nullable (no NOT NULL constraint) — new conversations are created before runAgent resolves the agent and updates the FK"
  - "Backfill uses org_id / organization_id cross-column JOIN (c.org_id = a.organization_id) per D-35-05 and RESEARCH Pitfall 5"
  - "No RLS policy added for this column — conversations table existing RLS covers it automatically"
  - "Manual database.ts edit used as fallback because supabase gen types --linked returns privilege error on this project plan tier"
requirements_completed:
  - GATE-07 (deferred from Phase 33: conversations.agent_id IS NULL count = 0 after backfill)
metrics:
  completed_date: "2026-05-16"
  tasks_completed: 3
  files_created: 1
  files_modified: 1
---

# Phase 35 Plan 01: Migration 043 + Types Update Summary

**One-liner:** Migration 043 adds `conversations.agent_id` FK and backfills all existing rows with the org's Main Agent; `src/types/database.ts` updated; `npm run build` exits 0. GATE-07 deferred from Phase 33 is now fully closed.

## Tasks Completed

| Task | Name | Result |
|------|------|--------|
| 1 | Write `supabase/migrations/043_conversations_agent_id.sql` | File written with ADD COLUMN + UPDATE backfill |
| 2 (checkpoint) | Operator: `npx supabase db push` | "Finished supabase db push." — 043 shows Local = Remote |
| 3 | Update `src/types/database.ts` conversations Row/Insert/Update + `npm run build` | Build exits 0, no type errors |

## Accomplishments

- `supabase/migrations/043_conversations_agent_id.sql` written and applied to remote DB via operator checkpoint
- `conversations.agent_id UUID REFERENCES agents(id) NULL` column now exists in remote Supabase
- Backfill UPDATE set `agent_id` to the org's Main Agent for all pre-existing conversations — `SELECT count(*) FROM conversations WHERE agent_id IS NULL` returns 0 (operator confirmed)
- `src/types/database.ts` conversations block extended:
  - `Row`: `agent_id: string | null`
  - `Insert`: `agent_id?: string | null`
  - `Update`: `agent_id?: string | null`
- `npm run build` exits 0 — all 40 routes compile cleanly, no downstream TypeScript regressions

## GATE-07 Status

GATE-07 was deferred from Phase 33 with a surrogate (D-33-20) because `conversations.agent_id` did not yet exist at Phase 33 time. Migration 043 now closes that gap:

```sql
SELECT count(*) FROM conversations WHERE agent_id IS NULL;
-- Returns: 0 (operator verified post-push)
```

GATE-07 is **COMPLETE**.

## Verification Checklist

- [x] `supabase/migrations/043_conversations_agent_id.sql` exists with `ADD COLUMN IF NOT EXISTS agent_id` + `UPDATE ... SET agent_id = (SELECT a.id FROM agents a WHERE a.organization_id = c.org_id AND a.name = 'Main Agent' LIMIT 1)`
- [x] Migration applied — `npx supabase migration list` shows 043 Local = Remote
- [x] `SELECT count(*) FROM conversations WHERE agent_id IS NULL` returns 0 (operator confirmed)
- [x] `src/types/database.ts` conversations.Row has `agent_id: string | null`
- [x] `src/types/database.ts` conversations.Insert has `agent_id?: string | null`
- [x] `src/types/database.ts` conversations.Update has `agent_id?: string | null`
- [x] `npm run build` exits 0

## Notes

- Backfill JOIN uses `a.organization_id = c.org_id` (different column names on the two tables) per D-35-05 and RESEARCH.md Pitfall 5 — this is intentional and correct.
- `agent_id` is nullable on purpose: `runAgent()` (Phase 35 Plan 03) will UPDATE the conversations row with the resolved agent ID after the first invocation; the column must be nullable to allow the brief window between conversation creation and first agent run.
- No RLS changes needed — the existing `conversations` table policy (`get_current_org_id()`) automatically scopes the new column.

## Next

Phase 35 Plan 02 (`35-02-PLAN.md`) is unblocked: AgentRunOptions extension + channel-defaults resolution + KB unconditional wiring.

---
*Phase: 35-web-widget-canary-cutover*
*Completed: 2026-05-16*

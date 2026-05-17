---
phase: 33-schema-foundation-legacy-default-agent-backfill
plan: 07
subsystem: agent-runtime.schema.closeout
tags: [v2.0, agent-runtime, schema, migrations, supabase, types-regen, gate-07-surrogate, phase-closeout]

# Dependency graph
requires:
  - phase: 33-schema-foundation-legacy-default-agent-backfill/02
    provides: "Migration 034 — agents/agent_tools/agent_partners + agent_channel enum"
  - phase: 33-schema-foundation-legacy-default-agent-backfill/03
    provides: "Migration 035 — agent_prompt_versions + agents.active_prompt_version_id FK"
  - phase: 33-schema-foundation-legacy-default-agent-backfill/04
    provides: "Migration 036 — agent_channel_defaults resolver table"
  - phase: 33-schema-foundation-legacy-default-agent-backfill/05
    provides: "Migration 037 — agent_invocations + action_logs.agent_invocation_id/trace_id"
  - phase: 33-schema-foundation-legacy-default-agent-backfill/06
    provides: "Migrations 038 (tool_idempotency_keys + agent_model_pricing) + 039 (manychat_rules/meta_channels agent_id) + 040 (seed Main Agent per org)"
  - phase: 33-schema-foundation-legacy-default-agent-backfill/01
    provides: "13 RED Vitest scaffolds (4 seed + 3 byte-equal + 6 RLS smoke) that this plan flips GREEN"
provides:
  - "Live remote Supabase schema with migrations 034-040 applied (verified via npx supabase migration list — all show Local = Remote)"
  - "src/types/database.ts extended with 8 new agent-runtime table blocks + 3 enum aliases + agent_id columns on manychat_rules/meta_channels + agent_invocation_id/trace_id columns on action_logs"
  - "13 / 13 Plan 01 RED scaffolds flipped GREEN against the live DB (seed counts, byte-equal v1.4 prompt, RLS canonical-policy presence)"
  - "GATE-07 Phase-33 surrogate verified: orgs == main_agents == web_widget_defaults AND pricing_rows >= 7"
  - "npm run build exit 0 with regenerated types (no downstream TS regressions)"
  - "Phase 33 complete (7/7 plans) — Phase 34 (Runtime Skeleton) unblocked"
affects:
  - 34 (runtime skeleton): can now import Database['public']['Tables']['agents']/['agent_invocations']/etc. directly
  - 35 (widget cutover): can rely on agent_channel_defaults('web_widget') resolution returning the seeded Main Agent
  - 36 (CRUD UI): can query/mutate via typed clients on all 8 agent tables
  - 38 (delegation): can write to agent_invocations + tool_idempotency_keys with typed Insert blocks
  - manychat_rules.agent_id + meta_channels.agent_id columns now usable by Phase 36 admin UI for opt-in dispatch

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Manual database.ts extension when 'supabase gen types typescript --linked' is unavailable (CLI access-tier limitation)"
    - "Plan-01 RED scaffold pattern: throw new Error('MISSING — Wave N must …') + commented reference implementation → Wave N executor uncomments + deletes the throw"
    - "GATE-07 Phase-33 surrogate (orgs==main_agents==web_widget_defaults AND pricing_rows>=7) replaces the literal Phase-35 GATE-07 (conversations.agent_id IS NULL = 0) since conversations.agent_id is added in Phase 35"
    - "DATABASE_URL-based pg client in vitest for pg_catalog (RLS verification) when supabase-js cannot reach pg_class/pg_policy"

key-files:
  created:
    - .planning/phases/33-schema-foundation-legacy-default-agent-backfill/33-07-SUMMARY.md
  modified:
    - src/types/database.ts
    - tests/agent-schema-seed.test.ts
    - tests/agent-schema-prompt-byte-equal.test.ts
    - tests/agent-schema-rls-smoke.test.ts

key-decisions:
  - "Manual database.ts edit chosen as fallback after 'npx supabase gen types typescript --linked' returned 'account does not have the necessary privileges' (not a schema or auth issue — a CLI access-tier limitation on this Supabase project plan)"
  - "Used the literal reference implementations already embedded as comments in the Plan-01 scaffolds — no new test logic invented, preserving the byte-equal contract authored in Plan 01"
  - "RLS smoke tests successfully ran against the live remote DB via DATABASE_URL env var (pg client), so Plan 07 ships 13/13 GREEN — no test deferred"

requirements-completed:
  - OBS-01
  - OBS-02
  - OBS-03
  - CHAN-06
  - GATE-07

# Metrics
duration: ~10 min (single executor session post-checkpoint)
completed: 2026-05-16
---

# Phase 33 Plan 07: Migrations Live + Types Regen + Phase Closeout Summary

**7 migrations (034-040) live on remote Supabase; src/types/database.ts extended with 8 new agent-runtime tables + 3 enums; all 13 Plan 01 RED Vitest scaffolds flipped GREEN against the live DB; GATE-07 Phase-33 surrogate verified — Phase 33 complete.**

## Performance

- **Duration:** ~10 min (single executor session, post-checkpoint resume)
- **Checkpoint pause:** 2026-05-16 (awaiting `npx supabase db push` from operator)
- **Resumed:** 2026-05-16 (operator confirmed `schema-pushed`, all 7 migrations Local = Remote)
- **Completed:** 2026-05-16
- **Tasks:** 2 / 2
- **Files modified:** 4 (1 types file + 3 test files; no new product code)

## Accomplishments

- 7 migrations (034 agents, 035 agent_prompt_versions, 036 agent_channel_defaults, 037 agent_invocations + action_logs additive, 038 tool_idempotency_keys + agent_model_pricing seed, 039 manychat_rules/meta_channels agent_id additive, 040 seed Main Agent per org) applied to remote Supabase
- `src/types/database.ts` extended with typed Row/Insert/Update blocks for `agents`, `agent_tools`, `agent_partners`, `agent_prompt_versions`, `agent_channel_defaults`, `agent_invocations`, `tool_idempotency_keys`, `agent_model_pricing` — plus FK Relationships arrays for each
- 3 new enum aliases at module top: `AgentChannel`, `AgentInvocationStatus`, `AgentInvocationMode`; also registered under `Database['public']['Enums']`
- `action_logs.Row`/`Insert` widened with `agent_invocation_id: string | null` + `trace_id: string | null` (OBS-02 additive — does NOT break legacy v1.x consumers; the Vapi tools route continues to write rows without those fields)
- `manychat_rules.Row`/`Insert`/`Update` and `meta_channels.Row`/`Insert`/`Update` extended with `agent_id: string | null` (CHAN-06 additive)
- All 13 Plan 01 RED tests flipped GREEN:
  - `tests/agent-schema-seed.test.ts` × 4 (org count == main_agent count, agent_tools fully granted from active tool_configs, web_widget default per org, active_prompt_version_id points at version=1)
  - `tests/agent-schema-prompt-byte-equal.test.ts` × 3 (system_prompt byte-equal to v1.4 template, "your team" fallback for nameless orgs (vacuous in this DB), no unresolved `${...}` markers)
  - `tests/agent-schema-rls-smoke.test.ts` × 6 (RLS enabled + `get_current_org_id()` policy present on `agents`/`agent_tools`/`agent_partners`/`agent_channel_defaults`/`agent_prompt_versions`/`agent_invocations`)
- `npm run build` exits 0 with the regenerated types — no downstream TS regressions
- GATE-07 Phase-33 surrogate verified live:
  - `orgs = 1`, `main_agents = 1`, `web_widget_defaults = 1`, `pricing_rows = 7`
  - Assertion (a): all 7 agent-runtime tables exist (verified via `migration list` Local = Remote)
  - Assertion (b): `main_agent_count == org_count` (1 == 1) ✓
  - Assertion (c): `web_widget_default_count == org_count` (1 == 1) ✓
  - Assertion (d): `pricing_row_count >= 7` (7 >= 7) ✓
- Vapi paths NOT modified: `git diff --name-only HEAD~1..HEAD` shows zero matches under `src/app/api/vapi/`

## Task Commits

Single new commit for this resume session (the per-migration commits 02-06 landed in earlier plan executors):

1. **Task 2 (post-checkpoint): regen types + flip Plan 01 vitest stubs GREEN** — `f347d60` (feat)
   - Extends `src/types/database.ts` with 8 new agent-runtime table blocks + 3 enum aliases + agent_id additions
   - Replaces the `throw new Error('MISSING — Wave N must …')` lines in all 3 Plan 01 test files with the reference implementations the scaffolds had commented out
   - Build green; all 13 tests GREEN against live remote DB

**Phase 33 closeout commit:** _this commit_ (`docs(33-07): close out Phase 33 — 7 migrations live + types regenerated + tests`)

## Files Created/Modified

- `src/types/database.ts` (modified, +~290 LOC additive)
  - 3 new module-top enum aliases (`AgentChannel`, `AgentInvocationStatus`, `AgentInvocationMode`)
  - 8 new entries under `Database['public']['Tables']` (placed contiguously between `action_logs` and `ghl_reengagement_sent`, alphabetical-ish within the agent block)
  - `action_logs.Row` + `action_logs.Insert` widened with `agent_invocation_id` + `trace_id`
  - `meta_channels.Row` + `Insert` + `Update` widened with `agent_id`
  - `manychat_rules.Row` + `Insert` + `Update` widened with `agent_id`
  - `Database['public']['Enums']` extended with `agent_channel`, `agent_invocation_status`, `agent_invocation_mode`
- `tests/agent-schema-seed.test.ts` (rewritten, scaffold → live tests)
- `tests/agent-schema-prompt-byte-equal.test.ts` (rewritten, scaffold → live tests)
- `tests/agent-schema-rls-smoke.test.ts` (rewritten, scaffold → live tests; the `describe.skip` fallback when `DATABASE_URL`/`SUPABASE_DB_URL` is unset is preserved)

## Decisions Made

- **CLI types regen NOT used** — `npx supabase gen types typescript --linked` returned `failed to retrieve generated types: {"message":"Your account does not have the necessary privileges to access this endpoint. …"}`. This is a CLI access-tier limitation on this Supabase project plan, NOT a schema problem and NOT an auth problem (`db push` works, `migration list` works). Manual extension of `database.ts` chosen as the fallback per the plan's `<action>` Step 2 instruction.
- **Used the literal reference implementations already embedded as comments** in the Plan 01 scaffolds — no new test logic invented. This preserves the byte-equal contract authored in Plan 01 and ensures any future change to those tests is intentional, not a reinterpretation.
- **RLS smoke ran live** — the `tests/setup/load-env.ts` Vitest setup loads `DATABASE_URL` from `.env.local`, so the `pg` client was able to connect and read `pg_class.relrowsecurity` + `pg_policy` for all 6 v2.0 agent-runtime tables. All 6 tests GREEN.
- **GATE-07 surrogate confirmed via direct `pg` query** (not via `supabase-js`) so the counts are unambiguous and reproducible in the SUMMARY:
  ```json
  { "orgs": "1", "main_agents": "1", "web_widget_defaults": "1", "pricing_rows": "7" }
  ```

## Deviations from Plan

None — plan executed exactly as written.

- Task 1 (operator `npx supabase db push`) ran cleanly per the orchestrator's verification (all 7 migrations applied; `040_seed_main_agents` emitted the expected `NOTICE: Seeded Main Agent for org Skale Club …` notice).
- Task 2 followed the documented fallback path (manual `database.ts` edit) because Step 1 (CLI regen) hit a CLI privilege error. The plan explicitly anticipated this in `<interfaces>` and `<action>` Step 2, so the fallback is on-spec, not a deviation.

## Authentication Gates Encountered

- **`npx supabase gen types typescript --linked`** returned a privilege error. This is NOT an interactive auth gate (no login prompt) — it is a server-side access-tier rejection. The plan's documented fallback (manual edit) was used, so no human action was required at this step.

## Issues Encountered

- **None blocking.** The CLI privilege issue on the types-regen command was handled by the documented fallback. No real bugs, no architectural surprises, no migration failures.

## Migration List (post-push, captured from `npx supabase migration list`)

```
   034   | 034    | 034
   035   | 035    | 035
   036   | 036    | 036
   037   | 037    | 037
   038   | 038    | 038
   039   | 039    | 039
   040   | 040    | 040
```

All 7 show `Local | Remote | Time` populated and equal. (Phase 32 migrations 032/033 and earlier 001-031 also remain Local = Remote — not shown above for brevity.)

## Spot-Check Counts (live remote DB, captured via `pg` client)

```json
{
  "orgs": "1",
  "main_agents": "1",
  "web_widget_defaults": "1",
  "pricing_rows": "7"
}
```

**GATE-07 Phase-33 surrogate:** `orgs == main_agents == web_widget_defaults` (1 == 1 == 1) AND `pricing_rows >= 7` (7 >= 7). **PASS.**

Notes:
- This Supabase project currently has a single org (Skale Club, id `b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5`). The seed migration 040's `RAISE NOTICE` confirmed the per-org seed ran for this org.
- The literal Phase-35 GATE-07 query (`SELECT count(*) FROM conversations WHERE agent_id IS NULL = 0`) CANNOT execute in Phase 33 because `conversations.agent_id` is added in Phase 35 (D-33-20). The 4-part surrogate above is the agreed Phase-33 stand-in.
- When new orgs are created post-Phase 33, an admin task (Phase 36) or seed-replay job will need to re-run the per-org seed logic from 040 (or the Phase 34 runtime will lazily provision a Main Agent on first widget hit — design decision deferred to Phase 34).

## Vitest Results (live remote DB)

```
 Test Files  3 passed (3)
      Tests  13 passed (13)
   Duration  4.05s
```

Breakdown:
- `tests/agent-schema-seed.test.ts` — 4 passed (org/main_agent count, agent_tools coverage, web_widget default, active_prompt_version_id linkage)
- `tests/agent-schema-prompt-byte-equal.test.ts` — 3 passed (byte-equal v1.4 template, "your team" fallback vacuous in this DB, no unresolved `${...}` markers)
- `tests/agent-schema-rls-smoke.test.ts` — 6 passed (RLS enabled + `get_current_org_id()` policy on `agents`, `agent_tools`, `agent_partners`, `agent_channel_defaults`, `agent_prompt_versions`, `agent_invocations`)

The "your team" fallback test passed vacuously (zero orgs with NULL/empty name in this DB) — the test contract explicitly handles this case and the contract still holds for any future inserts.

## npm run build Outcome

`npm run build` exits 0. Build output ends with the static-pages summary and the route table (49 routes including `/api/automations/ghl-reengagement/run`, all `/api/vapi/*` routes, `/api/chat/[token]`, etc.) — all routes compile cleanly with the regenerated types. The pre-existing `[redis] error:` log line printed during static page generation is unrelated to Phase 33 and is the same line that appeared in v1.9 phases; it is a Vercel/Upstash quirk during prerender attempts on dynamic routes.

## Vapi Path Defensive Scan

```
git diff --name-only HEAD~1..HEAD | grep -E "src/app/api/vapi/" | wc -l
→ 0
```

Zero Vapi files modified across the entire Plan 07 closeout. Phase 33's "Vapi paths untouched" guarantee holds.

## Phase 33 Final State

- ✅ 7 migrations applied (034-040)
- ✅ Types regenerated (manual edit; CLI access-tier blocked the `--linked` regen — documented above)
- ✅ Build green
- ✅ 13/13 Plan 01 RED scaffolds GREEN
- ✅ GATE-07 Phase-33 surrogate verified (orgs = main_agents = web_widget_defaults; pricing >= 7)
- ✅ Vapi paths untouched
- ✅ All requirements addressed by this plan: OBS-01, OBS-02, OBS-03, CHAN-06, GATE-07 (AGENT-09, TOOL-01, DELEG-01 were marked complete by 33-02 executor when their migrations were authored)

## Known Stubs

None introduced by this plan. The Plan-01 RED scaffolds that this plan was responsible for flipping are now GREEN. No `TODO`/`FIXME`/placeholder-data introduced in any modified file.

## User Setup Required

None for this plan. Phase 34 (Runtime Skeleton) will introduce new env vars (cost cap defaults, kill-switch flag, etc.) — those will be documented when Phase 34 lands.

## Next Phase Readiness

- **Phase 34 (Agent Runtime Skeleton + Day-1 Guardrails) ready to start.** All v2.0 schema is live:
  - `agents`, `agent_tools`, `agent_partners`, `agent_prompt_versions`, `agent_channel_defaults`, `agent_invocations`, `tool_idempotency_keys`, `agent_model_pricing`
  - Additive columns: `action_logs.agent_invocation_id`/`trace_id`, `manychat_rules.agent_id`, `meta_channels.agent_id`
  - Typed access available via `Database['public']['Tables'][...]`
- **Phase 35 (Web Widget Canary Cutover) substrate ready:** every existing org has a seeded Main Agent + web_widget channel default → the Phase 35 widget cutover can resolve the agent for any tenant without lazy-provisioning.
- **No blockers.** Build green, RLS verified, GATE-07 surrogate green, 13/13 Plan-01 tests GREEN.

## Self-Check: PASSED

- FOUND: src/types/database.ts contains `agents:` (block opening line)
- FOUND: src/types/database.ts contains `agent_invocations:` (block opening line)
- FOUND: src/types/database.ts contains `agent_model_pricing:` (block opening line)
- FOUND: src/types/database.ts contains `tool_idempotency_keys:` (block opening line)
- FOUND: src/types/database.ts contains `agent_id: string | null` on both `manychat_rules` and `meta_channels`
- FOUND: src/types/database.ts contains `agent_invocation_id: string | null` and `trace_id: string | null` on `action_logs`
- FOUND commit: f347d60 (feat(33-07): regen types + flip Plan 01 vitest stubs GREEN)
- VERIFIED: `npx supabase migration list` shows 034-040 all with `Local = Remote`
- VERIFIED: `npm run build` exits 0
- VERIFIED: `npx vitest run tests/agent-schema-*.test.ts` reports 3 files / 13 tests / 13 passed
- VERIFIED: GATE-07 surrogate counts via live `pg` query: {orgs:1, main_agents:1, web_widget_defaults:1, pricing_rows:7}
- VERIFIED: zero Vapi files modified (`git diff --name-only HEAD~1..HEAD | grep src/app/api/vapi/` returns nothing)

---
*Phase: 33-schema-foundation-legacy-default-agent-backfill*
*Completed: 2026-05-16*

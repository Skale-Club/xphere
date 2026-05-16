---
phase: 36-agent-crud-dashboard
plan: 05
subsystem: tests
tags: [vitest, rls, phase-gate, integration-tests, race-fix]

requires:
  - phase: 36-agent-crud-dashboard/03
    provides: tests/agents/fixtures.ts (seedTestOrg + serviceClient)
  - phase: 36-agent-crud-dashboard/04
    provides: form-actions test pattern + Plan 04 server actions module surface
  - phase: 33-schema-foundation-legacy-default-agent-backfill/01
    provides: tests/agent-schema-seed.test.ts + tests/agent-schema-prompt-byte-equal.test.ts global invariants
provides:
  - Cross-org RLS data-shape isolation tests across agents/agent_tools/agent_channel_defaults
  - End-to-end phase-gate lifecycle test (create -> attach -> channel-default -> soft-delete-with-reassignment)
  - AGENT-02 CHECK constraint coverage (temperature range 0..2)
  - Race-safe global invariant scans in Phase 33 seed-completeness tests
affects: [37 (channel adapters reuse soft-delete reassignment guarantee), 38 (delegation tests will reuse fixtures pattern), gsd:verify-work (phase 36 gate fully GREEN)]

tech-stack:
  added: []
  patterns:
    - "Service-role test fixtures verify organization_id stamping (data-shape isolation) since RLS bypasses for service role; canonical policy text pinned by tests/agent-schema-rls-smoke.test.ts (Phase 33)"
    - "Phase-gate test mirrors UI lifecycle against the DB directly (bypasses Next.js request context for auth) — replicates createAgent + updateAgent + setAgentTools + setChannelDefault + softDeleteAgent SQL shapes"
    - "Test-fixture org filter regex in global invariant tests: TEST_FIXTURE_NAME = /^(p\\d+...|RLS [AB] ...)/i so concurrent suites do not falsely break the seed-completeness contract"

key-files:
  created:
    - tests/agents/rls.test.ts
    - tests/agents/phase-gate.test.ts
  modified:
    - tests/agent-schema-seed.test.ts
    - tests/agent-schema-prompt-byte-equal.test.ts

key-decisions:
  - "Anon-key RLS verification deferred until a test-user-creation helper exists; data-shape isolation (organization_id stamping) is the testable surface today, and the canonical policy text is already pinned by Phase 33 agent-schema-rls-smoke.test.ts"
  - "Pre-existing tech debt fixed (Rule 2): Phase 33 global invariant tests scanned all orgs and broke whenever tests/agents/fixtures.ts seedTestOrg() or tests/rls-isolation.test.ts created concurrent test orgs without full Main Agent seed completeness — added a TEST_FIXTURE_NAME regex filter covering both naming conventions"
  - "Test-fixture filter regex deliberately strict (matches `p\\d+-<timestamp>-<rand>` and `RLS [AB] <rand>`) — future test files that introduce new naming conventions must update the regex; this preserves the invariant for any real seeded org without sentinel columns"

patterns-established:
  - "Pattern for any future phase that introduces global-scan invariant tests: exclude transient test fixtures by name pattern at the org list level, not by individual assertion skips"

metrics:
  duration: 14 min
  completed: 2026-05-16

stub_status:
  has_stubs: false
  notes: "No stubs introduced; both new test files exercise real DB writes against the live Supabase schema."
---

# Phase 36 Plan 05: Phase Gate Validation Summary

Two new vitest files lock down Phase 36 as a single executable phase-completion
signal: cross-org RLS data-shape isolation across agents / agent_tools /
agent_channel_defaults, and an end-to-end lifecycle test that exercises the
full CRUD chain (create Specialist -> attach tool -> set channel default ->
soft-delete with reassignment to Main Agent) against the live DB.

## What Shipped

- `tests/agents/rls.test.ts` (5 tests GREEN) — two distinct test orgs seeded
  with their own Main Agents; agents, agent_tools, agent_channel_defaults all
  asserted to be partitioned by organization_id. Service-role data-shape
  isolation; canonical RLS policy text is pinned by Phase 33
  `agent-schema-rls-smoke.test.ts`.

- `tests/agents/phase-gate.test.ts` (3 tests GREEN) — end-to-end lifecycle:
  1. Create Specialist (allowed_channels=['whatsapp']) and assert zero
     `agent_tools` rows (TOOL-03 deny-by-default).
  2. Attach one tool_config via `agent_tools` insert; assert count = 1.
  3. Upsert `agent_channel_defaults(whatsapp)` -> Specialist.
  4. Simulate `softDeleteAgent`: find Main Agent, reassign defaults, flip
     `is_active=false`.
  5. Assert default now points at Main Agent, Specialist is inactive, and
     historical `agent_tools` row still queryable (AGENT-10).
  Plus AGENT-02 coverage: temperature/max_tokens persist + CHECK constraint
  rejects out-of-range temperature (5.0).

## Verification Results

| Gate                                 | Result                                |
| ------------------------------------ | ------------------------------------- |
| `npx vitest run tests/agents`        | 6 files / 35 tests GREEN              |
| `npm test` (full suite)              | 55 files / 385 tests GREEN, 25 skipped, 327 todo |
| `npm run build`                      | Compiled successfully (22.0s)         |

Phase 36 requirements coverage in `tests/agents/**`:

| REQ        | File                                                                 |
| ---------- | -------------------------------------------------------------------- |
| AGENT-01   | form-actions.test.ts (slug uniqueness 23505)                         |
| AGENT-02   | phase-gate.test.ts (persistence + CHECK constraint)                  |
| AGENT-03   | zod-schemas.test.ts (channel_overrides shape)                        |
| AGENT-08   | phase-gate.test.ts (soft-delete with reassignment to Main Agent)     |
| AGENT-10   | phase-gate.test.ts (historical agent_tools still queryable)          |
| TOOL-02    | form-actions.test.ts (setAgentTools diff)                            |
| TOOL-03    | form-actions.test.ts + phase-gate.test.ts (deny-by-default)          |
| TOOL-04    | (TOOL-04 surfacing is a UI concern; data shape covered by ToolPickerData in Plan 04) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical infra] Schema mismatch in plan's seed code**
- **Found during:** Task 1 (writing rls.test.ts)
- **Issue:** Plan's example test code referenced `integrations.type` and
  `tool_configs.{name,type}` columns that do not exist. Real schema uses
  `integrations.provider` (+ `encrypted_api_key` NOT NULL) and
  `tool_configs.tool_name` / `tool_configs.action_type` / `tool_configs.fallback_message`.
- **Fix:** Test code uses the actual column names (verified against
  `tests/agents/list-actions.test.ts` Plan 03 baseline).
- **Files modified:** `tests/agents/rls.test.ts`, `tests/agents/phase-gate.test.ts`
- **Commits:** `3ccf724`, `6fa0675`

**2. [Rule 2 - Critical infra] Pre-existing test-suite race condition fixed**
- **Found during:** Task 2 (running `npm test`)
- **Issue:** Phase 33 invariant tests (`tests/agent-schema-seed.test.ts` and
  `tests/agent-schema-prompt-byte-equal.test.ts`) globally scan all orgs and
  assert seed completeness on every row. They raced against transient test
  fixture orgs created by `seedTestOrg()` (Phase 36 Plan 03) and the orgs in
  `tests/rls-isolation.test.ts` — those test orgs deliberately lack a full
  Main Agent seed (no `agent_tools`, `agent_channel_defaults(web_widget)`,
  `agent_prompt_versions`), causing 5 spurious failures during parallel runs.
- **Root cause:** Pre-existing tech debt — the global scans assumed the DB
  only contains "real" seeded orgs at scan time. Verified failures existed on
  prior HEAD before Plan 05 added anything.
- **Fix:** Added `TEST_FIXTURE_NAME` regex (matches both `p\d+-<ts>-<rand>` and
  `RLS [AB] <rand>` patterns) and a `getRealOrgs()` helper that filters out
  test fixtures before iterating. Real seeded orgs continue to be enforced.
- **Files modified:** `tests/agent-schema-seed.test.ts`,
  `tests/agent-schema-prompt-byte-equal.test.ts`
- **Commit:** `6fa0675`

## Commits

| Hash       | Message                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `3ccf724`  | test(36-05): add cross-org RLS isolation tests for Phase 36 tables    |
| `6fa0675`  | test(36-05): add phase-gate lifecycle + fix Phase 33 invariant race   |

## Phase 36 Closure

All five plans complete:

- Plan 01: schema + zod foundations
- Plan 02: shared contract surface (`src/lib/agents/*`)
- Plan 03: list page + 6 server actions (`getAgents`, `getActiveAgents`,
  `getChannelDefaults`, `setChannelDefault`, `toggleAgentActive`,
  `softDeleteAgent`)
- Plan 04: form actions + UI (`createAgent`, `updateAgent`, `setAgentTools`,
  `getAgentById`, `getToolPickerData`) + AgentForm + ToolPicker +
  ChannelOverridesEditor
- Plan 05 (this plan): cross-org RLS + phase-gate lifecycle tests; full suite
  + build GREEN

Phase 36 ready for `/gsd:verify-work` then advance to Phase 37
(ManyChat + Meta channel adapters).

## Self-Check: PASSED

- `tests/agents/rls.test.ts` exists (FOUND).
- `tests/agents/phase-gate.test.ts` exists (FOUND).
- Commit `3ccf724` exists in git log (FOUND).
- Commit `6fa0675` exists in git log (FOUND).
- `tests/agents/rls.test.ts` grep counts: "two distinct orgs"=2 (>=1),
  "partitioned by organization_id"=3 (>=3), "agent_channel_defaults"=5 (>=2),
  "agent_tools"=5 (>=2). PASS.
- `tests/agents/phase-gate.test.ts` grep counts: "phase gate lifecycle"=2 (>=1),
  "TOOL-03"=3 (>=1), "AGENT-02"=3 (>=1), "AGENT-10"=2 (>=1), "Main Agent"=3 (>=2). PASS.
- `npx vitest run tests/agents` exits 0: 35/35 GREEN.
- `npm test` exits 0: 385/385 GREEN.
- `npm run build` exits 0: Compiled successfully.

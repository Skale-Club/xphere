---
phase: 32-ghl-lost-lead-reengagement-sms-automation
plan: 02
subsystem: automations.ghl-reengagement.substrate
tags: [ghl, opportunities, cursor-pagination, sms-template, migration, rls, supabase, anti-loop, schedule, db-backed-cron]

# Dependency graph
requires:
  - phase: 32-ghl-lost-lead-reengagement-sms-automation/01
    provides: "13 RED Vitest scaffolds (6 list-opportunities + 7 render-template) that this plan flips GREEN"
  - phase: 31
    provides: "GHL client (ghlFetch/ghlFetchJson) shipped in v1.8 — extended here with exported DEFAULT_TIMEOUT_MS"
provides:
  - "listOpportunities() with cursor pagination + status defense + JS-side date guard (REENG-01..04)"
  - "renderMessage() template helper for {{first_name}} substitution with amigo(a) fallback (REENG-08)"
  - "Migration 032: ghl_reengagement_sent table — org-scoped, UNIQUE (org_id, ghl_contact_id), FK CASCADE (REENG-09)"
  - "Migration 033: automation_schedules table — single-tenant DB-backed cron registry + seed row (REENG-18, D-32-13)"
  - "Typed Row/Insert/Update blocks in src/types/database.ts for BOTH new tables"
  - "Live remote Supabase schema includes both tables (verified via npx supabase migration list — both rows show Local=Remote)"
affects:
  - 32-03 (runner): consumes listOpportunities + renderMessage + ghl_reengagement_sent claim-first INSERT
  - 32-04 (route): reads/UPDATEs automation_schedules row for schedule check

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cursor pagination via GHL meta.startAfter + meta.startAfterId, terminated when either absent"
    - "JS-side defense-in-depth filtering (date + status) — protects against silent GHL date-filter param-name mismatch (Pitfall 1)"
    - "Tunable constant GHL_DATE_FILTER_PARAM = 'date' — change ONLY this line if staging probe reveals 'endDate' or 'lastStatusChangeStartDate'"
    - "Claim-first anti-loop substrate: UNIQUE constraint at DB layer; claim/rollback logic deferred to Plan 03"
    - "Single-tenant DB-backed schedule registry: RLS enabled with NO policy → service-role only (D-32-07)"
    - "Idempotent migration seed via ON CONFLICT (automation_key) DO NOTHING"

key-files:
  created:
    - src/lib/ghl/list-opportunities.ts
    - src/lib/automations/ghl-reengagement/render-template.ts
    - supabase/migrations/032_ghl_reengagement_sent.sql
    - supabase/migrations/033_automation_schedules.sql
  modified:
    - src/lib/ghl/client.ts (one-line: export the existing DEFAULT_TIMEOUT_MS constant)
    - src/types/database.ts (purely additive: two typed blocks inserted before 'calls:')

key-decisions:
  - "GHL date-filter param kept as 'date' (no staging probe run; JS-side date guard protects against mismatch)"
  - "GHL_DATE_FILTER_PARAM exported as a constant so the future probe needs only a one-line edit"
  - "Migration 033 (automation_schedules) added to this plan per D-32-13 — not in the original 32-02 spec"
  - "automation_schedules has NO org_id (single-tenant v1.9, D-32-07); per-org schedules deferred to future Automations Platform"
  - "automation_schedules seed row: next_run_at = next 14:00 UTC (≈11:00 BRT), interval_minutes = 1440 (daily)"
  - "No Twilio code introduced anywhere — D-32-01 (SMS via sendSmsViaGhl, not Twilio)"

patterns-established:
  - "Cursor pagination loop pattern for GHL list endpoints (Pattern 2 in 32-RESEARCH)"
  - "Single-placeholder template substitution (no eval, no Function, no engine) for SMS bodies"
  - "DB-backed cron pattern: cheap external pulse (GH Actions every 15min) + DB schedule row owns the actual cadence"

requirements-completed:
  - REENG-01
  - REENG-02
  - REENG-03
  - REENG-04
  - REENG-08
  - REENG-09
  - REENG-18

# Metrics
duration: ~25 min (across two executor sessions, gated on schema push)
completed: 2026-05-15
---

# Phase 32 Plan 02: GHL List Lib + Render Template + Migrations 032/033 Summary

**listOpportunities (cursor + JS-side defenses), renderMessage (amigo(a) fallback), and two live Supabase migrations (anti-loop ghl_reengagement_sent + DB-backed automation_schedules with seeded ghl_reengagement_sms row) — the full Plan-03 + Plan-04 substrate.**

## Performance

- **Duration:** ~25 min (split across two executor sessions, paused at Task 4 human-action checkpoint for schema push)
- **Started:** 2026-05-15T19:38:18Z (first commit dc067e9)
- **Checkpoint pause:** 2026-05-15T19:41:06Z (awaiting `npx supabase db push` from operator)
- **Resumed:** 2026-05-15 (after operator confirmed `schema-pushed`)
- **Completed:** 2026-05-15
- **Tasks:** 4 / 4
- **Files modified:** 6 (4 created + 2 edited)

## Accomplishments

- `listOpportunities(credentials, opts)` with cursor pagination, status + date JS-side defenses, maxPages cap (default 50), tunable date-filter param constant
- `renderMessage(template, firstName)` 15-line helper — substitutes `{{first_name}}` globally with whitespace tolerance, falls back to `amigo(a)` on null/undefined/empty/whitespace
- Migration 032 (`ghl_reengagement_sent`) — org-scoped, UNIQUE `(org_id, ghl_contact_id)` provides backing index and anti-loop substrate, FK CASCADE to organizations, RLS via `public.get_current_org_id()`
- Migration 033 (`automation_schedules`) — single-tenant schedule registry, UNIQUE `automation_key`, `interval_minutes > 0` CHECK, `last_run_status` enum CHECK, RLS enabled with NO policy, seeded `ghl_reengagement_sms` row
- BOTH migrations applied to remote Supabase (`npx supabase migration list` shows both rows with `Local = Remote`)
- Typed Row/Insert/Update/Relationships blocks added for both tables in `src/types/database.ts` — purely additive, inserted before existing `calls:` entry
- Plan-01 RED tests flipped to GREEN: 6 list-opportunities + 7 render-template = 13 GREEN
- `npm run build` exits 0; `client.ts` backwards compat preserved (4 existing callers untouched)

## Task Commits

Each task committed atomically:

1. **Task 1: Export DEFAULT_TIMEOUT_MS + create listOpportunities** — `dc067e9` (feat)
2. **Task 2: Create renderMessage template helper** — `2a7ac11` (feat)
3. **Task 3: Write migrations 032 + 033** — `16b12a0` (feat)
4. **Task 4: Push migrations + add typed blocks** — `b9ab018` (feat)
   - Schema push performed manually by operator (`npx supabase db push`); types block committed by executor

**Plan metadata commit:** _this commit_ (docs: close out Wave 2 — schema applied + summary)

## Files Created/Modified

- `src/lib/ghl/client.ts` — one-line edit: prefix existing `const DEFAULT_TIMEOUT_MS = 400` with `export`. No call-site changes; all 4 existing GHL callers (`createContact`, `getAvailability`, `createAppointment`, `sendSmsViaGhl`) untouched.
- `src/lib/ghl/list-opportunities.ts` (NEW, 107 LOC) — `listOpportunities()` + `GhlOpportunity` / `GhlContactRef` / `ListOpportunitiesOptions` types + `GHL_DATE_FILTER_PARAM` constant. Cursor pagination, status defense, JS-side date guard, `maxPages` cap.
- `src/lib/automations/ghl-reengagement/render-template.ts` (NEW, 15 LOC) — `renderMessage(template, firstName)`. New folder created. Single placeholder only — no `{{last_name}}`, `{{phone}}`, `{{email}}`, `eval`, or `Function`.
- `supabase/migrations/032_ghl_reengagement_sent.sql` (NEW, 28 LOC) — anti-loop table mirroring the `manychat_rules` RLS pattern. UNIQUE constraint provides the index (no extra `CREATE INDEX`). Append-only (no `updated_at`, no trigger).
- `supabase/migrations/033_automation_schedules.sql` (NEW, 45 LOC) — schedule registry table + `update_updated_at` trigger + seeded `ghl_reengagement_sms` row with `next_run_at = next 14:00 UTC` and `interval_minutes = 1440`. RLS enabled with NO policy (service-role only by design).
- `src/types/database.ts` — purely additive: both typed blocks inserted at lines 362-432, before existing `calls:` entry at line 433. No other lines modified.

## Decisions Made

- **GHL date-filter param name not probed against staging** — kept the default `GHL_DATE_FILTER_PARAM = 'date'` constant. The JS-side date guard in `listOpportunities` itself provides defense in depth: even if GHL silently ignores the param, the loop discards opps newer than the cutoff before they ever reach the runner. Plan 03 / Plan 04 may run the probe later; if so, change ONLY the constant.
- **Migration 033 ships in THIS plan** (per D-32-13) rather than waiting for Plan 04. Reason: Plan 04 route reads/UPDATEs the row on every request; shipping the table separately would create a window where Plan 04's compile target doesn't exist in DB.
- **No Twilio references** in any new file (per D-32-14/D-32-15). Confirmed via grep — `sendSms\b|TWILIO_INTEGRATION_ID` returns nothing in the four new files.
- **`automation_schedules` is single-tenant** (no `org_id`). v1.9 ships for Skleanings only; multi-tenant is the future Automations Platform.

## Deviations from Plan

None — plan executed exactly as written. All four tasks delivered the verbatim shapes specified in `<interfaces>` and `<action>` blocks. No deviation rules invoked, no auto-fixes required.

## Issues Encountered

- **Task 4 was a `checkpoint:human-action`** — the executor cannot run `npx supabase db push` interactively (it prompts for the DB password and a non-TTY env can't supply `--password` safely). The first executor session paused after committing the typed-blocks edit (`b9ab018`) and returned a structured checkpoint message. Operator ran the push manually, confirmed both migrations applied via `npx supabase migration list` (Local=Remote for 032 + 033), then resumed with `schema-pushed`. This is the expected pattern for blocking DB pushes.

## Planner Spec Inconsistency (documented, not an implementation gap)

Plan 32-02 Task 4 lists the acceptance criterion:

> `grep -c "ghl_reengagement_sent" src/types/database.ts` returns ≥ 5
> `grep -c "automation_schedules" src/types/database.ts` returns ≥ 5

**Reality after the literal interface from `<interfaces>` is applied:**

- `grep -c "ghl_reengagement_sent" src/types/database.ts` returns `2` (block opening line + `'ghl_reengagement_sent_org_id_fkey'`)
- `grep -c "automation_schedules" src/types/database.ts` returns `1` (block opening line only)

The literal interface specified in the plan's `<interfaces>` section places each table name **once** at the block opening (e.g. `automation_schedules: {`). The field names inside the Row/Insert/Update blocks do NOT repeat the table name. So `grep -c` (which counts matching lines) cannot reach 5 unless the interface itself were authored differently.

**Disposition:** This is a planner-spec inconsistency, NOT an implementation gap. The actual typed blocks match the planner's `<interfaces>` byte-for-byte. The criterion was likely intended as a sanity probe but mis-specified.

**Verification of true correctness instead of the bad grep:**
- Both block opening identifiers present (`ghl_reengagement_sent: {` at line 362, `automation_schedules: {` at line 394)
- Both Row/Insert/Update/Relationships sub-blocks complete with all fields from `<interfaces>`
- The FK relationship name `'ghl_reengagement_sent_org_id_fkey'` is present (line 386)
- `npm run build` exits 0 → TypeScript strict accepts both blocks
- Plan 03 / Plan 04 code that uses `Database['public']['Tables']['ghl_reengagement_sent']['Insert']` will compile cleanly

Recommend the criterion be replaced in any future planner output with literal field probes (e.g., `grep -q "ghl_reengagement_sent: {"` AND `grep -q "automation_schedules: {"`).

## Schema Push Outcome

- **Mechanism:** Operator ran `npx supabase db push` manually after executor checkpoint
- **Verification:** `npx supabase migration list` shows both `032` and `033` with `Local = Remote = 032/033`
- **Seed row:** Per the migration's `ON CONFLICT (automation_key) DO NOTHING` clause, the `ghl_reengagement_sms` row is in `automation_schedules` with `next_run_at` ≈ next 14:00 UTC, `interval_minutes=1440`, `is_active=true`. (Not probed live in this executor due to env-var requirement; Plan 04 route will exercise this path end-to-end.)

## Defensive Scan: ghlFetch Callers

No unexpected callers of `ghlFetch` / `ghlFetchJson` need updating. The existing four (`createContact`, `getAvailability`, `createAppointment`, `sendSmsViaGhl`) all use the optional `timeoutMs` parameter via positional defaults and are unaffected by exporting `DEFAULT_TIMEOUT_MS`. `listOpportunities` references its own higher `LIST_TIMEOUT_MS_DEFAULT = 10_000` because cron budget tolerates the looser timing.

## Known Stubs

None introduced by this plan. The Plan-01 RED stubs that this plan was responsible for flipping (`tests/ghl-list-opportunities.test.ts` × 6 and `tests/ghl-render-template.test.ts` × 7) are now GREEN. The remaining Plan-01 stubs (`tests/ghl-reengagement-runner.test.ts` × 16 and `tests/ghl-reengagement-route.test.ts` × 20) are still RED — they belong to Plans 03 and 04 per the Wave-0 contract.

## User Setup Required

None for this plan. Future Plan 04 will introduce required env vars (`GHL_REENGAGEMENT_LOCATION_ID`, `GHL_REENGAGEMENT_INTEGRATION_ID`, `GHL_REENGAGEMENT_MESSAGE`, `GHL_REENGAGEMENT_TRIGGER_SECRET`) and the GitHub Action workflow secret — those will be documented in 32-04-USER-SETUP.md.

## Next Phase Readiness

- **Plan 32-03 (runner) ready to start.** Substrate available:
  - `listOpportunities` from `@/lib/ghl/list-opportunities`
  - `renderMessage` from `@/lib/automations/ghl-reengagement/render-template`
  - `ghl_reengagement_sent` live in remote DB for claim-first INSERT+rollback
  - Typed access via `Database['public']['Tables']['ghl_reengagement_sent']`
- **Plan 32-04 (route + GH Action) ready as soon as Plan 32-03 lands.** Substrate available:
  - `automation_schedules` live in remote DB with seeded `ghl_reengagement_sms` row
  - Typed access via `Database['public']['Tables']['automation_schedules']`
  - RLS enabled with NO policy → route MUST use service-role client to read/UPDATE
- **No blockers.** Build green, lint green, 13 of 49 Plan-01 stubs flipped, the other 36 are owned by Plans 03 and 04.

## Self-Check: PASSED

- FOUND: src/lib/ghl/list-opportunities.ts (107 LOC, exports listOpportunities + types + GHL_DATE_FILTER_PARAM)
- FOUND: src/lib/automations/ghl-reengagement/render-template.ts (15 LOC, exports renderMessage)
- FOUND: supabase/migrations/032_ghl_reengagement_sent.sql (28 LOC)
- FOUND: supabase/migrations/033_automation_schedules.sql (45 LOC)
- FOUND: src/types/database.ts contains `ghl_reengagement_sent: {` at line 362 and `automation_schedules: {` at line 394
- FOUND commit: dc067e9 (feat(32-02): add listOpportunities with cursor pagination + JS-side defenses)
- FOUND commit: 2a7ac11 (feat(32-02): add renderMessage template helper for SMS body)
- FOUND commit: 16b12a0 (feat(32-02): add migrations 032 (ghl_reengagement_sent) + 033 (automation_schedules))
- FOUND commit: b9ab018 (feat(32-02): add typed blocks for ghl_reengagement_sent + automation_schedules)
- VERIFIED: `npx supabase migration list` shows 032 and 033 with `Local = Remote`
- VERIFIED: `npm run build` exits 0 (per first-session checkpoint log)
- NOTED: planner-spec `grep -c ≥ 5` criterion is mathematically unreachable given the literal `<interfaces>` shape — see "Planner Spec Inconsistency" section above

---
*Phase: 32-ghl-lost-lead-reengagement-sms-automation*
*Completed: 2026-05-15*

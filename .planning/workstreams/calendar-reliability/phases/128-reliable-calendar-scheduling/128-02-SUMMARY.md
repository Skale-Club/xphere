---
phase: 128-reliable-calendar-scheduling
plan: 02
subsystem: calendar
tags: [cron, auth, security, vitest, tdd]

# Dependency graph
requires:
  - phase: 128-reliable-calendar-scheduling
    provides: "Plan 01's src/lib/calendar/tick.ts (not consumed by this plan directly, but this plan closes the auth half of the same route Plan 05 will wire tick.ts into)"
provides:
  - "src/app/api/cron/calendar-tick/route.ts's auth block now mandatorily requires CRON_SECRET (503 if unset, 401 on mismatch, read fresh per-request)"
  - "tests/calendar-tick-route.test.ts — 5-test route-level auth suite covering 503/401/pass-through/runtime export, fully mocked @supabase/supabase-js (no production DB touched)"
affects: [128-05-route-wiring, calendar-tick-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mandatory-secret cron auth: missing secret = 503 (server misconfiguration), wrong/missing header = 401, read process.env inside the handler (not a module-level const) — ported verbatim from src/app/api/cron/global-knowledge-notion/route.ts"
    - "Route-level auth test via vi.mock('@supabase/supabase-js') + direct GET import (mirrors tests/ghl-reengagement-route.test.ts), avoiding any real network/DB call even though .env.local points at the real production Supabase project"

key-files:
  created:
    - tests/calendar-tick-route.test.ts
  modified:
    - src/app/api/cron/calendar-tick/route.ts

key-decisions:
  - "Ported the global-knowledge-notion route's auth block verbatim (per the plan's <interfaces> block) rather than adopting the stronger timingSafeEqual variant from ghl-reengagement/run/route.ts — RESEARCH.md flagged that as optional hardening, not required by SCH-03's wording, and the plan's interfaces block specified the simpler pattern explicitly"
  - "Left SUPABASE_URL/SERVICE_KEY as module-level consts untouched — plan scoped this task to the auth block only; scan/dedup logic is Plan 128-05's job"

requirements-completed: [SCH-03]

# Metrics
duration: 3min
completed: 2026-07-16
---

# Phase 128 Plan 02: Calendar-Tick Endpoint Mandatory Auth Summary

**Closed the SCH-03 unauthenticated-invocation gap on `calendar-tick/route.ts` by replacing its optional `if (CRON_SECRET) {...}` check with a mandatory 503-if-unset / 401-if-mismatched pattern ported verbatim from `global-knowledge-notion/route.ts`, proven by a 5-test mocked-Supabase route suite.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-16T04:34:17Z
- **Completed:** 2026-07-16T04:37:52Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `tests/calendar-tick-route.test.ts` — 5 tests proving: `CRON_SECRET` unset → 503 with `"CRON_SECRET"` in the error body; missing/wrong `Authorization` header (when secret is configured) → 401 in both cases; correct `Bearer {secret}` header → neither 401 nor 503; `runtime` export equals `'nodejs'`
- `src/app/api/cron/calendar-tick/route.ts`: deleted the module-level `const CRON_SECRET = process.env.CRON_SECRET` (captured once at import time, invisible to test-time env mutation) and replaced the optional `if (CRON_SECRET) {...}` auth block with a mandatory check that reads `process.env.CRON_SECRET` fresh inside `GET()`
- Diff scoped exclusively to the auth block — no scan/dedup/dispatch logic touched (confirmed via `git diff`), preserving Plan 128-05's ownership of that code
- `npm run build` passes with zero type errors; full route test file green (5/5)

## Task Commits

Each task was committed atomically (TDD RED → GREEN, no REFACTOR needed):

1. **Task 1: Write the failing route auth test** - `3891ccad` (test)
2. **Task 2: Fix the CRON_SECRET auth block in route.ts** - `e5dc2d1d` (fix)

**Plan metadata:** _pending (this commit follows)_

## Files Created/Modified
- `tests/calendar-tick-route.test.ts` - Route-level auth test suite: mocks `@supabase/supabase-js` via a generic chainable Proxy so the "correct secret" pass-through case never issues a real query against this worktree's production-pointed `.env.local`
- `src/app/api/cron/calendar-tick/route.ts` - Auth block only: `CRON_SECRET` is now read inside `GET()` and mandatory (503 if unset, 401 on mismatch); `SUPABASE_URL`/`SERVICE_KEY` module-level consts and all logic below the auth block are unchanged

## Decisions Made
- Used the simpler `!==` string comparison (not `timingSafeEqual`) per the plan's explicit `<interfaces>` block, which specifies the `global-knowledge-notion` pattern verbatim — RESEARCH.md notes the constant-time variant is optional hardening, not an SCH-03 requirement
- Kept `SUPABASE_URL`/`SERVICE_KEY` as module-level consts (only `CRON_SECRET` needed to move inside the handler, since only the secret needed to become test-mutable and freshly-read per request)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The RED phase failed exactly as predicted (3 of 5 cases returned 200 instead of 503/401, because the old module-level `CRON_SECRET` constant was already set from `.env.local` at test-file import time, before `beforeEach`/`afterEach` could mutate `process.env.CRON_SECRET` for each case) — confirming the test correctly targeted the bug before any fix was applied.

## User Setup Required

None - no external service configuration required. `CRON_SECRET` is already provisioned in production Coolify env per RESEARCH.md, so this tightening does not require any new operator action and cannot break prod.

## Next Phase Readiness
- SCH-03's auth half is fully closed. SCH-03's "durable scheduling progress" half (watermark persistence) remains for Plans 128-04/128-05, which will also wire `src/lib/calendar/tick.ts` (from Plan 128-01) into this same route's scan/dedup logic below the now-hardened auth block
- `tests/calendar-tick-route.test.ts` establishes the route-level test file Plan 128-05 can extend (or leave standalone) when it adds scan-logic coverage
- No blockers for subsequent Phase 128 plans

---
*Phase: 128-reliable-calendar-scheduling*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: tests/calendar-tick-route.test.ts
- FOUND: src/app/api/cron/calendar-tick/route.ts
- FOUND: .planning/workstreams/calendar-reliability/phases/128-reliable-calendar-scheduling/128-02-SUMMARY.md
- FOUND: 3891ccad (test commit)
- FOUND: e5dc2d1d (fix commit)

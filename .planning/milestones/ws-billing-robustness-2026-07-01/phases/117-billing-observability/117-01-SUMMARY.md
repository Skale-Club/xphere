---
phase: 117-billing-observability
plan: 01
subsystem: payments
tags: [stripe, billing, observability, event_logs, vitest]

# Dependency graph
requires:
  - phase: 114-metering-architecture
    provides: "meterDebit() generic credit-debit interface (MET-01..04) that this plan's Task 2 wires logging into"
  - phase: 116-billing-test-coverage
    provides: "tests/billing-webhook.test.ts and tests/billing-credit-rpcs.test.ts test scaffolding this plan extends"
provides:
  - "Stripe webhook route's outer catch block emits an event_logs row (source: stripe-webhook, event_type: webhook.failed) on any handleEvent() processing exception"
  - "meterDebit()'s catch block emits an event_logs row (source: billing-credits, event_type: credit_debit.failed, org_id) on any RPC failure, while preserving the existing fail-open return value"
  - "Bug fix: error-message extraction in meterDebit() now correctly reads .message from Supabase RPC error objects (not just native Error instances)"
affects: [billing-robustness milestone close-out, /admin/logs viewer usage for billing triage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget observability wiring: void log({...}) inside existing catch blocks, never awaited, never re-thrown — matches src/lib/logger.ts's documented never-throws contract"

key-files:
  created: []
  modified:
    - src/app/api/stripe/webhook/route.ts
    - src/lib/billing/credits.ts
    - tests/billing-webhook.test.ts
    - tests/billing-credit-rpcs.test.ts

key-decisions:
  - "Omitted org_id on the Stripe webhook catch-block log() call per RESEARCH.md — org_id is resolved inside per-branch helpers within handleEvent() and does not propagate to the outer catch; event.id/event.type in payload is sufficient for admin triage without restructuring handleEvent()'s signature"
  - "Fixed (Rule 1 - bug) error-message extraction in meterDebit(): err instanceof Error check alone missed Supabase RPC error objects ({ message: string }, not an Error instance) thrown via `if (error) throw error` — added a typeof/property check so error_message reflects the actual RPC error text instead of '[object Object]'"

requirements-completed: [BOB-01, BOB-02, BOB-03]

# Metrics
duration: 25min
completed: 2026-07-01
---

# Phase 117 Plan 01: Billing Observability Wiring Summary

**Stripe webhook and meterDebit() failure catch blocks now write structured event_logs rows via the existing log() helper, closing the billing observability gap with zero new schema/UI/helpers.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-01T16:19:56Z (approx, first task commit at 16:23:08Z)
- **Completed:** 2026-07-01T16:42:01Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments
- Stripe webhook route's outer `catch (err)` block now calls `void log({...})` with `source: 'stripe-webhook'`, `event_type: 'webhook.failed'`, `status: 'failed'`, `actor_type: 'webhook'`, `actor_id: event.id`, and a payload carrying the Stripe event type/id — surfacing processing failures that were previously only in `console.error`/Sentry (BOB-01)
- `meterDebit()`'s catch block now calls `void log({...})` with `source: 'billing-credits'`, `event_type: 'credit_debit.failed'`, `org_id: orgId`, `status: 'failed'`, and a payload carrying `reason`/`cost_usd`/`ref_id` — surfacing silent fail-open credit-debit failures (BOB-02), while the function's existing `{ allowed: true, balanceAfter: 0 }` fail-open return is fully preserved
- Confirmed (BOB-03, no code changes) that the existing `/admin/logs` viewer + `getPlatformLogs()` server action already support exact-match `source` filtering and auto-derive the `sources` dropdown from distinct `event_logs.source` values (`src/app/(admin)/admin/logs/_actions/get-platform-logs.ts` lines 124-125, 178) — both new source tags (`stripe-webhook`, `billing-credits`) will appear automatically once a real failure is logged, with zero UI changes required
- Extended both target test files with mocked-`log()` assertions proving the exact call shape at each site, without disturbing any of the other 24 pre-existing tests in those two files

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire Stripe webhook processing-failure logging (BOB-01)** - `9e0e33df` (feat)
2. **Task 2: Wire meterDebit failure logging (BOB-02)** - `9d8114c9` (feat, includes Rule 1 bug fix)

**Plan metadata:** (this commit, to follow)

## Files Created/Modified
- `src/app/api/stripe/webhook/route.ts` - Added `import { log } from '@/lib/logger'`; outer catch block now emits a `webhook.failed` / `source: 'stripe-webhook'` event_logs row before returning the existing 500 response
- `src/lib/billing/credits.ts` - Added `import { log } from '@/lib/logger'`; `meterDebit()`'s catch block now emits a `credit_debit.failed` / `source: 'billing-credits'` event_logs row before returning the existing fail-open result; fixed error-message extraction to handle Supabase RPC error objects
- `tests/billing-webhook.test.ts` - Added `vi.mock('@/lib/logger', ...)` + import; extended the "processing failure" test with an assertion on the `log()` call shape
- `tests/billing-credit-rpcs.test.ts` - Added `vi.mock('@/lib/logger', ...)` + import; extended both "fails OPEN" tests with assertions on the `log()` call shape

## Decisions Made
- Omitted `org_id` from the Stripe webhook catch-block log call (platform-level event; not resolvable at the outer catch without restructuring `handleEvent()`'s signature) — matches the plan's explicit instruction and RESEARCH.md's finding
- See "Deviations from Plan" below for the RPC error-message extraction fix

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed error-message extraction in meterDebit() to handle Supabase RPC error objects**
- **Found during:** Task 2 — the "fails OPEN when the RPC returns an error field" test failed after adding the plan's exact `err instanceof Error ? err.message : String(err)` line, because `supabase.rpc()` returns `error: { message: string }` (a plain object, not a native `Error`), which the code re-throws via `if (error) throw error`. `err instanceof Error` was `false` for this path, so `String(err)` produced `"[object Object]"` instead of the RPC's actual message ("db exploded"), breaking the plan's specified test assertion (`error_message: 'db exploded'`).
- **Issue:** The plan's action block specified `const message = err instanceof Error ? err.message : String(err)`, which does not cover thrown non-Error objects with a `.message` property (the exact shape Supabase's PostgrestError-like RPC errors have).
- **Fix:** Extended the message extraction to also check `typeof err === 'object' && err !== null && 'message' in err`, falling back to `String((err as { message: unknown }).message)` before the final `String(err)` fallback.
- **Files modified:** `src/lib/billing/credits.ts`
- **Verification:** Both "fails OPEN" tests in `tests/billing-credit-rpcs.test.ts` pass with the plan's exact expected `error_message` values (`'db exploded'` and `'network exploded'`)
- **Committed in:** `9d8114c9` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary correction to make the plan's own specified test assertions pass; no scope creep — same catch block, same log() call, just correct message extraction for the RPC error shape actually returned by Supabase.

## Issues Encountered
- `npm run build` failed on the first attempt with `FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory` during the TypeScript-check phase of the Next.js build. This is a pre-existing environment resource constraint unrelated to this plan's two-line-per-file changes (webpack compile succeeded; only the subsequent `tsc` pass ran out of heap). Retried with `NODE_OPTIONS="--max-old-space-size=6144" npm run build`, which completed successfully (all routes compiled, `verify-sw` OK). No code change was needed; this is an environment/tooling note, not a plan deviation.
- Full `npx vitest run` (unfiltered, 180 files) reported 37 failed test files / 64 failed tests, entirely in files unrelated to this plan (auth/callback, members-actions, accounts, action-engine, agents, contacts, meta-webhook-*, pipeline-*, etc.) — none in `tests/billing-webhook.test.ts` or `tests/billing-credit-rpcs.test.ts`, both of which pass 100% (26/26) standalone and together. Representative failures suggest missing/unreachable live-DB test fixtures or Next.js 16 request-scope issues in unrelated test harnesses, pre-dating this plan. Logged to `117-billing-observability/deferred-items.md` per the executor's scope-boundary rule; not fixed here.

## User Setup Required

None - no external service configuration required. The `/admin/logs` UI, `event_logs` table, and `log()` helper all pre-exist and are unmodified; the two new `source` tags will appear in the existing `sources` filter dropdown automatically the first time a real failure is logged in any environment.

## BOB-03 Manual Verification Note

Per the plan's `<verification>` section and `117-VALIDATION.md`'s sign-off, BOB-03 ("Platform admin can filter /admin/logs by source and see these failures") is satisfied by pre-existing, unmodified code — `getPlatformLogs()` already supports exact `source` equality filtering (`get-platform-logs.ts:124-125`) and the `sources` dropdown already auto-derives from distinct `event_logs.source` values observed in the last lookback window (`get-platform-logs.ts:178`). This was confirmed by direct source read during this plan's execution, not by a live click-through, since no real or staged Stripe-webhook/meterDebit failure has occurred yet in any environment to populate a `stripe-webhook` or `billing-credits` row. Recommend an informal confirmation pass (load `/admin/logs`, filter by `source=stripe-webhook` or `source=billing-credits`) the first time either failure occurs naturally in staging/production, consistent with the phase's validation strategy.

## Next Phase Readiness
- Both billing failure call sites (Stripe webhook, Copilot credit debit) are now observable via the existing `/admin/logs` viewer with zero new schema, UI, or helper code
- This closes out the last requirement (BOB-01/02/03) of Phase 117, and with it the `billing-robustness` v3.2 milestone's four target phases (114-117) are all complete
- No blockers for milestone close-out; the pre-existing full-suite test failures noted above are unrelated to billing and tracked separately in `deferred-items.md` for future investigation

---
*Phase: 117-billing-observability*
*Completed: 2026-07-01*

## Self-Check: PASSED

All claimed files exist on disk and both task commit hashes (`9e0e33df`, `9d8114c9`) are present in git history.

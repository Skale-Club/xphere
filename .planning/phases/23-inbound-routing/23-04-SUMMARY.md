---
phase: 23-inbound-routing
plan: "04"
subsystem: api
tags: [manychat, webhook, dispatcher, action-engine, vitest]

# Dependency graph
requires:
  - phase: 23-inbound-routing/23-02
    provides: dispatchManychatEvent function + DispatchInput interface
  - phase: 23-inbound-routing/23-03
    provides: manychat_routing_rules table + rule-matching logic
provides:
  - End-to-end ManyChat webhook chain: secret gate -> event insert -> inline dispatch
  - Extended webhook test coverage with dispatcher invocation assertions (8 tests)
  - ROUTING-03 and ROUTING-04 wired end-to-end
affects:
  - 23-inbound-routing (closes phase)
  - any future plan adding manychat_send_message action type (Phase 25 candidate)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline dispatch (not after()) within webhook handler — dispatcher call awaited before returning 200"
    - "Service-role client threaded through from webhook to dispatcher — required for RLS-bypass UPDATE on manychat_events"
    - "orgId resolved from channel lookup only — never from request body (security invariant)"
    - ".select('id').single() chained on insert to capture new UUID for dispatcher"

key-files:
  created: []
  modified:
    - src/app/api/manychat/webhook/route.ts
    - tests/manychat/webhook.test.ts

key-decisions:
  - "Inline dispatch chosen over after() for v1: total latency ~500-700ms, well under ManyChat 10s External Request timeout"
  - "Same supabase service-role client passed to dispatcher — no authenticated UPDATE policy on manychat_events"
  - "Pre-existing action-engine ACTN-12 test failure deferred — unrelated to Phase 23 scope"

patterns-established:
  - "Mock builder for webhook tests must chain .select('id').single() on insert spy to match route's chain"
  - "Dispatcher mock added at top level of webhook test file to prevent transitive matcher execution"

requirements-completed:
  - ROUTING-03
  - ROUTING-04

# Metrics
duration: 10min
completed: 2026-05-06
---

# Phase 23 Plan 04: Wire ManyChat Dispatcher into Webhook Handler Summary

**ManyChat webhook now chains secret gate -> event insert (.select('id').single()) -> inline dispatchManychatEvent call, completing the Phase 23 inbound routing loop end-to-end**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-06T20:40:30Z
- **Completed:** 2026-05-06T20:50:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Webhook handler imports and calls `dispatchManychatEvent` inline after event insert, passing the inserted event UUID and channel-resolved orgId
- `.select('id').single()` added to the `manychat_events.insert(...)` chain so the dispatcher receives a real event id
- Webhook test file extended to 8 tests: 403 path asserts dispatcher is NOT called; valid path asserts dispatcher IS called with the orgId from `channel.org_id` (never from body); payload passthrough verified
- Full vitest suite: 185 passed / 244 todo / 1 pre-existing failure (unrelated ACTN-12) — zero regressions from Phase 23 changes
- `npm run build` exits 0; `/api/manychat/webhook` confirmed in dynamic route list

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify webhook route to dispatch inline** - `799789c` (feat)
2. **Task 2: Extend webhook tests — assert dispatcher invocation on matched path** - `f212e77` (test)
3. **Task 3: Full suite + build verification** - (no new files, verification only)

## Files Created/Modified

- `src/app/api/manychat/webhook/route.ts` - Added `dispatchManychatEvent` import; chained `.select('id').single()` on insert; added conditional inline dispatch call
- `tests/manychat/webhook.test.ts` - Added dispatcher mock at top level; updated `buildWebhookMockSupabase` to return insert chain with id; added 3 new tests across 1 new describe block

## Decisions Made

- **Inline dispatch (not `after()`):** Plan specified inline explicitly. Latency budget is ~500-700ms total, within ManyChat's 10s External Request timeout. Revisit for Phase 25 if `manychat_send_message` adds round-trip latency.
- **Same service-role client to dispatcher:** No authenticated UPDATE policy on `manychat_events`; service role required for dispatcher to write back status and action_log_id.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

**Pre-existing test failure (out of scope):** `tests/action-engine.test.ts > ACTN-12` — `logAction` returns `null` instead of `undefined` on Supabase insert error. Confirmed pre-existing before Phase 23-04 changes via `git stash` verification. Logged to `deferred-items.md`. Not a Phase 23 regression.

## Known Stubs

None — both files wired to real implementations.

## User Setup Required

Migration 027 (`manychat_routing_rules`, `manychat_events` schema updates) is written but not pushed to production. Requires `SUPABASE_DB_PASSWORD` to apply. This is a pre-existing blocker tracked in STATE.md — not introduced in this plan.

## Next Phase Readiness

Phase 23 is complete and ready for `/gsd:verify-work`. Full inbound routing chain is wired:
- Secret gate (Plan 23-01)
- Event insert + routing rules table (Plan 23-01, 23-02, 23-03)
- Inline dispatch through action engine (Plan 23-04)

Remaining item before live testing: `npx supabase db push` to apply migration 027 (requires SUPABASE_DB_PASSWORD).

---
*Phase: 23-inbound-routing*
*Completed: 2026-05-06*

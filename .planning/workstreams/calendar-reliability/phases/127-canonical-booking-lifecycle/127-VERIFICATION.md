---
phase: 127-canonical-booking-lifecycle
verified: 2026-07-16T00:25:00Z
status: passed
score: 21/21 must-haves verified
re_verification: false
requirements_covered: [LIFE-01, LIFE-02, LIFE-03, LIFE-04]
notes:
  - "Combined real-DB suite run deadlocks (Postgres 40P01) when calendar-overlap-constraint (mig 1249), calendar-rls (mig 1250), and calendar-lifecycle-rpc (mig 1251) apply migrations in-transaction concurrently against the same live DB. Each passes cleanly in isolation — infrastructure flakiness, not a phase-127 code defect."
  - "tests/action-engine.test.ts has 8 pre-existing failures (Vapi tools webhook route / GHL fallback) documented in deferred-items.md; confirmed pre-existing on branch baseline, unrelated to booking lifecycle, excluded from verdict."
---

# Phase 127: Canonical Booking Lifecycle Verification Report

**Phase Goal:** All booking writers use one tested state transition and event emission service.
**Verified:** 2026-07-16T00:25:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

Every booking status transition now flows through one canonical, RPC-backed, org-scoped, idempotent, single-event-emitting service (`src/lib/calendar/transition.ts`) backed by the `transition_booking_status` SECURITY DEFINER RPC (migration 1251, applied to production). All five writer categories — native dashboard/public actions, MCP tools, the Xkedule webhook, the durable flow engine, and the wait-free action-engine dispatcher — delegate to it. A direct-write sweep of `src/` confirms only the two documented, expected direct `bookings.status` writes remain (Xkedule mirror carve-out + `rescheduleBooking`'s guarded `UPDATE...WHERE status='confirmed'`).

### Observable Truths

| #   | Truth (source plan) | Status | Evidence |
| --- | ------------------- | ------ | -------- |
| 1   | Illegal from-state rejected with typed error, not silently applied (127-01) | ✓ VERIFIED | RPC raises `illegal_transition`; `runStatusTransition` maps to `{ok:false,error:'illegal_transition'}`; real-DB test 3 green |
| 2   | Re-requesting same transition is idempotent, no second event (127-01) | ✓ VERIFIED | RPC returns `transitioned:false`; guarded funcs early-return before `emitCalendarEvent`; real-DB test 2 green |
| 3   | org_id verified server-side before mutation despite SECURITY DEFINER (127-01) | ✓ VERIFIED | Migration 1251 `v_org_id IS DISTINCT FROM p_org_id → RAISE booking_not_found`; real-DB test 4 green |
| 4   | Exactly one `'showed'` status; `meeting.completed` fires on transition to showed (127-01) | ✓ VERIFIED | `markShowed` writes `'showed'`, emits `meeting.completed`; booking-status.ts single source of truth |
| 5   | `{{meeting.title}}`/`{{meeting.event_type.name}}` real title, not `'Meeting'` (127-02) | ✓ VERIFIED | scope.ts selects `event_types.title` (was non-existent `.name`); calendar-scope.test.ts green |
| 6   | `{{meeting.organizer.name/email}}` populated from host (127-02) | ✓ VERIFIED | scope.ts resolves via `auth.admin.getUserById(eventType.user_id)`, graceful degrade |
| 7   | Cancelling already-cancelled from dashboard is no-op, no 2nd event (127-03) | ✓ VERIFIED | `cancelBooking` delegates to `transitionCancelBooking` (idempotent guard); calendar-bookings.test.ts green |
| 8   | Public cancel-token goes through same guarded transition (127-03) | ✓ VERIFIED | `cancelBookingByToken` token-verify SELECT then `transitionCancelBooking`; no direct status update in file |
| 9   | createBooking/createBookingInternal use shared vocabulary (127-03) | ✓ VERIFIED | Both write `status: BOOKING_STATUSES[0]` (lines 521, 733) |
| 10  | MCP bookings_cancel emits meeting.cancelled (127-04) | ✓ VERIFIED | Handler delegates to `cancelBooking({supabase},...)` (line 216); mcp-bookings.test.ts green |
| 11  | bookings_list filters all four statuses incl showed (127-04) | ✓ VERIFIED | `z.enum(['confirmed','cancelled','no_show','showed'])` (line 60) |
| 12  | Xkedule mirror update failure emits no event (127-05) | ✓ VERIFIED | Update branch checks `updateErr` → `return ok({skipped:'update_failed'})` before emit (route line 235-239) |
| 13  | Xkedule completed → native showed (127-05) | ✓ VERIFIED | `mapStatus`: `if (s === 'completed') return 'showed'` (line 61) |
| 14  | Xkedule showed fires meeting.completed (127-05) | ✓ VERIFIED | `calendarEventFor`: `if (status === 'showed') return 'meeting.completed'` (line 68) |
| 15  | booking_mark_complete writes showed + emits meeting.completed (127-06) | ✓ VERIFIED | `executeBookingMarkComplete` delegates to `markShowed`, returns `status:'showed'` (engine.ts 557-572) |
| 16  | Every booking_* action node emits its matching event (127-06) | ✓ VERIFIED | All 6 handlers delegate to canonical funcs; executeBookingCreate emits `meeting.scheduled` (617) |
| 17  | Workflow action node cannot mutate another org's booking (127-06) | ✓ VERIFIED | Every handler passes `ctx.orgId`; RPC re-checks org boundary; engine.test.ts green |
| 18  | Wait-free workflow can use booking_* nodes (no "Unknown action type") (127-07) | ✓ VERIFIED | 5 `booking_*` registrations in execute-action.ts (188-216) + import (39-43); action-engine-booking.test.ts green |
| 19  | update_booking_status rejects illegal transition (127-07) | ✓ VERIFIED | Dispatches by status to guarded transition funcs; throws on `!result.ok` (update-booking-status.ts 27-33) |
| 20  | Migration 1251 applied to production (127-08) | ✓ VERIFIED | Orchestrator-confirmed: applied via MCP; SECURITY DEFINER + service_role-only EXECUTE verified post-apply |
| 21  | Real-DB RPC test passes against production, not soft-skipped (127-08) | ✓ VERIFIED | calendar-lifecycle-rpc.test.ts 6/6 green in isolation against live DB |

**Score:** 21/21 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/migrations/1251_booking_lifecycle_transition.sql` | Atomic guard+write RPC | ✓ VERIFIED | SECURITY DEFINER, FOR UPDATE lock, org re-check, REVOKE/GRANT service_role; applied to prod |
| `src/lib/calendar/booking-status.ts` | Single source BookingStatus + list | ✓ VERIFIED | Derives from DB Row type; exports BookingStatus/BOOKING_STATUSES/isBookingStatus |
| `src/lib/calendar/transition.ts` | Canonical lifecycle service | ✓ VERIFIED | confirm/cancel/markNoShow/markShowed/reschedule + runStatusTransition; emit-after-success |
| `src/lib/calendar/scope.ts` | Correct title select + organizer | ✓ VERIFIED | selects `event_types.title`; organizer resolved from host user |
| `src/lib/action-engine/executors/booking-lifecycle-actions.ts` | Wait-free thin adapter | ✓ VERIFIED | 5 exports wired into execute-action.ts dispatcher |
| `src/lib/action-engine/executors/update-booking-status.ts` | Guarded, dispatches by status | ✓ VERIFIED | Routes to canonical funcs; uses shared BOOKING_STATUSES/isBookingStatus |
| Test files (9) | Coverage for all writers | ✓ VERIFIED | lifecycle, status-vocabulary, scope, bookings, mcp-bookings, xkedule-webhook, engine, action-engine-booking, lifecycle-rpc all green |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| transition.ts | migration 1251 RPC | `rpc('transition_booking_status', ...)` | ✓ WIRED |
| transition.ts::markShowed | events.ts | `event: 'meeting.completed'` | ✓ WIRED |
| scope.ts | event_types.title | `select('id, title, slug, ..., user_id')` | ✓ WIRED |
| native cancelBooking / cancelBookingByToken | transition.ts::cancelBooking | `transitionCancelBooking({supabase},...)` | ✓ WIRED |
| MCP bookings_cancel | transition.ts::cancelBooking | `cancelBooking({supabase, depth:0},...)` | ✓ WIRED |
| xkedule mapStatus | booking-status | `completed → 'showed'` | ✓ WIRED |
| flows/engine.ts booking_* | transition.ts | `confirmBooking/markShowed/...` with ctx.orgId | ✓ WIRED |
| execute-action.ts | booking-lifecycle-actions.ts | 5 special-cased `booking_*` dispatches | ✓ WIRED |
| update-booking-status.ts | transition.ts | dispatch by target status | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| scope.ts (MeetingScope) | `title`, `organizer` | `event_types.title` + `auth.admin.getUserById` | Yes (was silently null via wrong column) | ✓ FLOWING |
| transition RPC result | `transitioned/old/new` | live `bookings` UPDATE...RETURNING | Yes (real-DB test confirms row persists) | ✓ FLOWING |

### Behavioral Spot-Checks

The phase's own test suites are the behavioral checks — run directly against real code (and the live DB for the RPC suite).

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full phase suite (13 files) | `npx vitest run <13 suites>` | 177 passed, 6 skipped; 1 suite deadlock (parallel-DB, see note) | ✓ PASS (isolated) |
| RPC against production schema | `npx vitest run tests/calendar-lifecycle-rpc.test.ts` | 6/6 passed | ✓ PASS |
| Type + production build | `npm run build` | success (route manifest + postbuild verify-sw OK) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
| ----------- | ------------ | ----------- | ------ | -------- |
| LIFE-01 | 01,03,04,06,07,08 | One canonical service, guards, transactional, one event | ✓ SATISFIED | RPC + transition.ts + all writers delegate; real-DB test green |
| LIFE-02 | 01,05,06 | Agreed states incl completion/showed | ✓ SATISFIED | booking-status.ts single source; no 'completed' writes; vocabulary test green |
| LIFE-03 | 03,04,05,06,07 | All writers use contract, no event after failed write | ✓ SATISFIED | native/MCP/Xkedule/both engines wired; Xkedule update-error guard |
| LIFE-04 | 02 | Documented meeting/event/trigger-offset vars consistent | ✓ SATISFIED | scope.ts title fix + organizer populated; offset vars present |

No orphaned requirements — REQUIREMENTS.md maps exactly LIFE-01..04 to Phase 127, all claimed across the plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No `status: 'completed'` writes, no stale local BookingStatus unions, no orphaned artifacts | — | — |

Direct `bookings.status` write sweep: only `transition.ts` rescheduleBooking (guarded `UPDATE...WHERE status='confirmed'`) and Xkedule webhook `mutable` (documented mirror carve-out, phase 129 will route through the service). Both expected per phase boundary.

### Human Verification Required

None blocking. Optional operational note carried from plan 127-08's smoke test: cancelling a real/disposable booking from the dashboard and confirming a `meeting.cancelled` row lands in `event_dispatches` — an end-to-end production confirmation, not a code correctness gate.

### Gaps Summary

No gaps. The phase goal is achieved: one tested state-transition + event-emission service exists (`transition.ts` + RPC), every writer category delegates to it, the status vocabulary is unified and enforced by a static test that scans all seven writer files (including `flows/engine.ts`), no event is emitted after a failed write, and calendar workflow payloads now expose real `title`/`organizer` data.

Two non-blocking observations, both explicitly out of scope for the verdict:
1. Running all real-DB migration suites (1249/1250/1251) in one concurrent vitest invocation triggers a Postgres deadlock in `beforeAll`; each suite passes cleanly in isolation. This is test-runner concurrency against a shared live DB, not a code defect. A future hardening pass could serialize or namespace these suites.
2. `tests/action-engine.test.ts` has 8 pre-existing failures (Vapi tools webhook / GHL fallback) documented in `deferred-items.md`, confirmed pre-existing on the branch baseline and unrelated to booking lifecycle.

---

_Verified: 2026-07-16T00:25:00Z_
_Verifier: Claude (gsd-verifier)_

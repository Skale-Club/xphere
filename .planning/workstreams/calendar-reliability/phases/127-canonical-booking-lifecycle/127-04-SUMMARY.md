---
phase: 127-canonical-booking-lifecycle
plan: 04
subsystem: calendar
tags: [mcp, vitest, booking-lifecycle, tdd]

requires:
  - phase: 127-canonical-booking-lifecycle
    provides: "transition.ts::cancelBooking (RPC-backed, org-scoped, idempotent) + booking-status.ts's BOOKING_STATUSES vocabulary (Plan 127-01)"
provides:
  - "src/lib/mcp/tools/bookings.ts's bookings_cancel MCP tool delegates the guarded status write + single meeting.cancelled emission to transition.ts::cancelBooking, instead of writing status: 'cancelled' directly and emitting nothing"
  - "bookings_list/bookings_create's local MCP BookingStatus zod enum now includes 'showed', matching the full DB vocabulary"
  - "bookings_create sources its insert-time status literal from BOOKING_STATUSES[0] instead of a bare 'confirmed' string"
affects: [127-05, 127-06, 127-07, 127-08]

tech-stack:
  added: []
  patterns:
    - "MCP writer delegation pattern (mirrors Plan 127-03's native writer pattern): the MCP tool handler keeps its own org-scoped side-write (notes append) but hands the guarded status write + event emission to the canonical transition.ts service"

key-files:
  created: []
  modified:
    - src/lib/mcp/tools/bookings.ts
    - tests/mcp-bookings.test.ts

key-decisions:
  - "Kept the two @/lib/calendar/transition imports (emitCalendarEvent, cancelBooking) as separate import statements rather than merging them, consistent with Plan 127-03's same decision on the same source module"
  - "Fixed a plan-authoring bug: the plan's own <action> code mapped cancelBooking's booking_not_found error straight through as { error: 'booking_not_found', status: 404 }, contradicting its own <behavior> spec (which requires { error: 'not_found', status: 404 }) and this file's existing not_found convention (bookings_get, and the handler's own reason-branch early return) -- remapped booking_not_found -> 'not_found' to match both"

requirements-completed: [LIFE-01, LIFE-03]

duration: 6min
completed: 2026-07-16
---

# Phase 127 Plan 04: Wire MCP bookings_cancel to the Canonical Lifecycle Service Summary

**`bookings_cancel` MCP tool now delegates its guarded status write to `transition.ts::cancelBooking` (emitting `meeting.cancelled`) instead of silently writing `status: 'cancelled'` with no event; the MCP status filter/enum vocabulary widened to the full four-value `BookingStatus` set.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-16T03:24:56Z
- **Completed:** 2026-07-16T03:30:59Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `bookings_cancel`'s handler no longer writes `status: 'cancelled'` directly — it now calls `transition.ts::cancelBooking({ supabase, depth: 0 }, booking_id, auth.orgId)`, closing the gap where a cancellation made via any MCP-connected client (Claude, ChatGPT, or another MCP agent) fired zero workflow events, unlike the dashboard button and public cancel-token link (both wired in Plan 127-03).
- The existing "append reason to notes" side-write is preserved verbatim and still runs BEFORE the transition call (not merged into it) — a notes-write failure can never silently block or duplicate the actual cancellation, and the pre-existing `not_found` early return (when `reason` is supplied but the booking doesn't exist) is unchanged.
- `transition.ts::cancelBooking`'s `booking_not_found`/`illegal_transition` error results now map to this file's established `{ error: 'not_found', status: 404 }` / `{ error: 'illegal_transition', status: 409 }` shapes; the idempotent already-cancelled `{ ok: true }` case returns `{ cancelled: true }` exactly as a fresh cancellation does.
- The module-level `BookingStatus` zod enum (used by `bookings_list`'s `status` filter and `bookings_create`'s input schema) now includes `'showed'`, so an MCP client can filter/see `showed` bookings like every other real DB status.
- `bookings_create`'s insert now writes `status: BOOKING_STATUSES[0]` instead of a bare `'confirmed'` string literal, sourcing the value from the single shared vocabulary (Plan 127-01) — no behavior change.
- 6 new tests added to `tests/mcp-bookings.test.ts`'s new `bookings_cancel MCP tool` describe block, covering: no-reason delegation, notes-append-then-transition ordering with a `reason`, the `reason`+missing-booking early return, `illegal_transition`→409, `booking_not_found`→404, and the idempotent `ok:true`→`cancelled` mapping. File total: 10/10 passing.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1 RED: add failing test for bookings_cancel MCP tool** - `6533d11a` (test)
2. **Task 1 GREEN: wire bookings_cancel to transition.ts::cancelBooking** - `d7319848` (feat)
3. **Task 2: bookings_create sources status literal from BOOKING_STATUSES** - `eb0809c2` (feat)

**Plan metadata:** (pending — this commit)

## Files Created/Modified

- `src/lib/mcp/tools/bookings.ts` - `bookings_cancel` delegates to `transition.ts::cancelBooking`; `BookingStatus` enum widened to include `'showed'`; `bookings_create` inserts `BOOKING_STATUSES[0]`
- `tests/mcp-bookings.test.ts` - added `bookings_cancel MCP tool` describe block (6 new tests); mocked `cancelBooking` alongside the existing `emitCalendarEvent` mock in the `@/lib/calendar/transition` module mock

## Decisions Made

- Kept the two `@/lib/calendar/transition` imports (`emitCalendarEvent`, `cancelBooking`) as separate `import` statements rather than merging onto one line — matches Plan 127-03's same decision on the sibling native-writer file, and matches this plan's own literal action text ("Add `import { cancelBooking } from '@/lib/calendar/transition'` to the imports")
- Remapped `cancelBooking`'s `booking_not_found` error to this file's existing `'not_found'` convention rather than leaking the transition service's internal error string — see Deviations below

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's own `<action>` code contradicted its own `<behavior>` spec for the `booking_not_found` mapping**
- **Found during:** Task 1 GREEN phase, running the new `transition.ts::cancelBooking returns booking_not_found -> maps to not_found/404` test
- **Issue:** The plan's `<behavior>` section explicitly states: "Given `transition.ts::cancelBooking` returns `{ ok: false, error: 'booking_not_found' }` → the handler returns `{ error: 'not_found', status: 404 }`." But the plan's own `<action>` code block (which I initially copied verbatim) built a `statusByError` lookup that only remapped the HTTP `status` code, not the `error` string — it returned `{ error: result.error, status: 404 }`, i.e. `{ error: 'booking_not_found', status: 404 }`, leaking the transition service's internal error string and diverging from both the plan's stated behavior and this file's own existing `not_found` convention (used by `bookings_get` and by this same handler's reason-branch early return a few lines above).
- **Fix:** Replaced the `statusByError` lookup-table approach with explicit `if` branches that remap `booking_not_found` → `{ error: 'not_found', status: 404 }` and `illegal_transition` → `{ error: 'illegal_transition', status: 409 }`, matching the plan's `<behavior>` spec exactly.
- **Files modified:** `src/lib/mcp/tools/bookings.ts`
- **Verification:** `npx vitest run tests/mcp-bookings.test.ts` — all 10 tests pass, including the `booking_not_found` mapping test
- **Committed in:** `d7319848` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a plan self-inconsistency between `<action>` and `<behavior>`, same category of issue documented in Plans 127-01 and 127-03's summaries)
**Impact on plan:** Necessary to satisfy the plan's own stated `<behavior>` contract and this file's existing error-shape convention. No scope creep — only the error-remapping branch was changed.

## Issues Encountered

None beyond the one auto-fixed deviation above.

## User Setup Required

None - no external service configuration required. Migration 1251 (`transition_booking_status` RPC, from Plan 127-01) remains intentionally unapplied to production, unaffected by this plan.

## Known Stubs

None. `bookings_cancel` is fully wired to the canonical transition service with real behavior; no placeholder data or hardcoded empty states introduced.

## Next Phase Readiness

- All three MCP booking writers (`bookings_create`, `bookings_cancel`, and the read-only `bookings_list`/`bookings_get`) are now consistent with the shared `BookingStatus`/`BOOKING_STATUSES` vocabulary and, for the mutating cancel path, the canonical `transition.ts` service established in Plan 127-01
- `tests/mcp-bookings.test.ts` is green (10/10) and `npm run build` passes
- Plans 127-05 through 127-07 (workflow actions, Xkedule inbound, and any remaining writer categories) can proceed against the same canonical `transition.ts` service, now exercised end-to-end by both native (127-03) and MCP (127-04) writer categories
- Migration 1251 (`transition_booking_status` RPC) is still unapplied to production — Plan 127-08's operator-gated apply step remains the blocker for any of these RPC-backed calls to actually succeed against the live database; this is expected and does not block further planning/execution of Wave 2 plans
- No blockers

---
*Phase: 127-canonical-booking-lifecycle*
*Completed: 2026-07-16*

## Self-Check: PASSED

Both key-files confirmed present on disk (`src/lib/mcp/tools/bookings.ts`, `tests/mcp-bookings.test.ts`). All 3 task commits confirmed present in git history (`6533d11a`, `d7319848`, `eb0809c2`).

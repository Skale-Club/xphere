# Phase 107: Event Dispatch — Summary

**Plan:** 107-01
**Status:** Complete ✅

## What Changed

### Core fix: `src/lib/scheduling/transition.ts`
- Updated `findMatchingWorkflows()` to also select `current_version_id` (needed to load workflow definitions for dispatch)
- Added `import { runFlowSync }` and `import { buildMeetingScope }`
- Rewrote `emitCalendarEvent()` to actually **invoke** `runFlowSync()` for each matched workflow, mirroring the `emitOpportunityEvent()` pattern in `pipeline/events.ts`:
  1. Build meeting scope via `buildMeetingScope()` (was previously never called)
  2. Load workflow definitions from `workflow_versions`
  3. Fire `runFlowSync()` fire-and-forget with `.catch()` per workflow
- Threads cascade depth from `TransitionContext.depth` (MAX_CASCADE_DEPTH=3 guard already in place)
- A failing workflow does not block the originating booking mutation

### Booking server actions: `src/app/(dashboard)/scheduling/_actions/bookings.ts`
- **`createBooking()`**: After successful booking insert, emits `meeting.scheduled` event (fire-and-forget)
- **`cancelBooking()`**: After successful cancellation, emits `meeting.cancelled` event (fire-and-forget, uses service-role client)
- **`cancelBookingByToken()`**: After successful cancellation, emits `meeting.cancelled` event; also added `org_id` to SELECT

### Pipeline events: no changes needed
- `emitOpportunityEvent()` already fully wired to `runFlowSync()` ✅

## Requirements Fulfilled
- **EVNT-01**: Wire booking creation/update to trigger matched workflow runs ✅
- **EVNT-02**: Wire pipeline stage transitions (already done — verified) ✅
- **EVNT-03**: MAX_CASCADE_DEPTH guard (already exists, threaded through `TransitionContext.depth`) ✅
- **EVNT-04**: Service-role client with fire-and-forget semantics ✅

## Verification
- `npm run build` → TypeScript compiles successfully ✅
- `npx vitest run` → 82 files pass, 38 pre-existing failures, no regressions ✅

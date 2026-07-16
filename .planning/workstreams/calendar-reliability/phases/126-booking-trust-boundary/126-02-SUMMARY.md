---
phase: 126-booking-trust-boundary
plan: 02
subsystem: calendar
tags: [mcp, booking-validation, vitest, supabase]

# Dependency graph
requires:
  - phase: 126-booking-trust-boundary
    provides: "126-01: resolveAndValidateSlot shared slot-validation core (src/lib/calendar/booking-validation.ts)"
provides:
  - "src/lib/mcp/tools/bookings.ts::bookings_create now calls resolveAndValidateSlot — event-type-active + availability-window + organizer-wide conflict validation identical to the public booking flow"
  - "bookings_create's end_at input field is deprecated/optional and always ignored — end_at is always server-derived from event_types.duration_minutes"
affects: [calendar-reliability, mcp-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP tool handlers reuse the same resolve+validate core as public server actions instead of duplicating inline checks"

key-files:
  created:
    - tests/mcp-bookings.test.ts
  modified:
    - src/lib/mcp/tools/bookings.ts

key-decisions:
  - "end_at kept as an optional (not removed) input field on bookings_create's schema so existing MCP callers that still send a stale end_at are not rejected by .strict() validation — the value itself is always discarded server-side"
  - "The old inline event_types existence+org-scoped .maybeSingle() check was fully removed, not left alongside the new call — resolveAndValidateSlot already does an org-scoped, active-filtered lookup, so keeping both would be redundant/dead code"

patterns-established:
  - "Any future programmatic booking-creation entry point (webhooks, other MCP tools) should call resolveAndValidateSlot rather than re-implementing slot validation"

requirements-completed: [CAL-01]

# Metrics
duration: 10min
completed: 2026-07-16
---

# Phase 126 Plan 02: MCP bookings_create Trust Boundary Summary

**The MCP `bookings_create` tool now calls the shared `resolveAndValidateSlot` core instead of trusting a client-supplied `end_at` and skipping availability/conflict checks — closing the actual CAL-01 gap RESEARCH.md identified in the programmatic booking entry point.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-15T21:44:00-04:00
- **Completed:** 2026-07-15T21:52:24-04:00
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `tests/mcp-bookings.test.ts` — 4 new unit tests (RED then GREEN) proving `bookings_create` rejects `event_type_not_found`/`outside_availability`/`slot_taken` from the mocked `resolveAndValidateSlot`, never calls `bookings.insert` on rejection, always inserts the server-resolved `end_at` (never the client-supplied stale value), and still honors an explicit `contact_id` when supplied
- `src/lib/mcp/tools/bookings.ts`'s `bookings_create` handler rewired: the old inline `event_types` existence/org-check + trusted `input.end_at` insert is replaced with a call to `resolveAndValidateSlot(supabase, { eventTypeId, startAtIso, orgId: auth.orgId })`, mapping each `SlotValidationError` to the same HTTP status codes the public flow implies (404/422/409/409)
- `end_at` is now an optional, deprecated, ignored input field (kept only so existing callers sending it are not rejected by `.strict()`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write tests/mcp-bookings.test.ts against the desired bookings_create behavior** - `140e94ef` (test)
2. **Task 2: Wire bookings_create to resolveAndValidateSlot** - `5f9c7953` (feat)

**Plan metadata:** _(pending — recorded after this SUMMARY commit)_

## Files Created/Modified
- `tests/mcp-bookings.test.ts` - 4 unit tests covering event_type_not_found/outside_availability/slot_taken rejection, server-derived end_at, and explicit contact_id passthrough
- `src/lib/mcp/tools/bookings.ts` - `bookings_create` handler now delegates slot resolution/validation to `resolveAndValidateSlot`; `end_at` schema field made optional/ignored

## Decisions Made
- Kept `end_at` in the input schema as optional rather than removing it outright, to avoid breaking existing MCP callers under `.strict()` schema validation while still guaranteeing the value is never trusted.
- Removed the old inline event-type lookup entirely instead of leaving it alongside the new call — `resolveAndValidateSlot`'s own org-scoped, `active`-filtered lookup fully subsumes it.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CAL-01 is now closed on both booking-creation entry points named in RESEARCH.md: the public `createBooking` server action (126-01) and the MCP `bookings_create` tool (this plan).
- No blockers for any remaining phase 126 plan (126-06, if any remains) or downstream workstream phases.

---
*Phase: 126-booking-trust-boundary*
*Completed: 2026-07-16*

## Self-Check: PASSED

All claimed files exist on disk (`tests/mcp-bookings.test.ts`, `src/lib/mcp/tools/bookings.ts`) and both task commit hashes (`140e94ef`, `5f9c7953`) resolve in `git log`.

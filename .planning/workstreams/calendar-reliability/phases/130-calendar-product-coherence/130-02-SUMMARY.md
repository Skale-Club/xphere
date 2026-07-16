---
phase: 130-calendar-product-coherence
plan: 02
subsystem: calendar
tags: [supabase, vitest, contacts, meeting-scope, workflow-variables, booking-status]

# Dependency graph
requires:
  - phase: 127-canonical-booking-lifecycle (plan 02)
    provides: "buildMeetingScope's event_types.title column fix and organizer hydration via auth.admin.getUserById — this plan verifies and extends test coverage for that fix rather than re-implementing it"
  - phase: 130-calendar-product-coherence (plan 01)
    provides: "bookingStatusBadgeClass() precedent in src/lib/calendar/booking-status.ts establishing the sky-colored 'showed' badge treatment this plan mirrors in the contact panel"
provides:
  - "mapContactBookingRow() — pure, unit-testable mapper fixing the event_types(title)-vs-.name join bug in getContact's booking summaries"
  - "Confirmed (via disk read + 2 new tests) that Phase 127-02's organizer-hydration and event_types.title fixes in scope.ts are present and correct"
  - "Contact panel booking badges render 'showed' with a distinct sky-colored badge, matching the dashboard bookings list"
affects: [calendar-product-coherence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure join-row mappers extracted into src/lib/{domain}/*.ts modules when the consuming file has 'use server' and can only export async functions (mirrors booking-summary.ts's extraction rationale)"
    - "event_types(name:title) select-alias idiom for reading the title column through a .name-shaped consumer without renaming every downstream read"

key-files:
  created:
    - src/lib/contacts/booking-summary.ts
    - tests/contacts-actions-bookings.test.ts
  modified:
    - src/app/(dashboard)/contacts/actions.ts
    - tests/calendar-scope.test.ts
    - src/components/chat/contact-info-panel.tsx

key-decisions:
  - "Task 2 made zero production changes to src/lib/calendar/scope.ts — read the file on disk first and confirmed both of Phase 127-02's stated deliverables (title-column select, hydrated organizer variable in the return statement) were already present, per the plan's VERIFY-AND-EXTEND scoping to avoid duplicating 127-02's work"
  - "Added 2 new tests to tests/calendar-scope.test.ts (not a rewrite) — a select-shape regression guard asserting the event_types query never re-introduces the nonexistent name column, and a test confirming organizer.email sources from the top-level user.email rather than user_metadata.email"

requirements-completed: [SYNC-03]

# Metrics
duration: 12min
completed: 2026-07-16
---

# Phase 130 Plan 02: Contact Booking Summary Join Fix + Scope.ts Verification + Badge Consistency Summary

**Fixed the `event_types(title)`-vs-`.name` join bug that made every contact-panel booking show the generic "Booking" label, confirmed Phase 127-02's `scope.ts` organizer-hydration fix is live with 2 new regression tests, and gave `'showed'` bookings a distinct sky-colored badge in the contact panel matching the dashboard bookings list.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-16T02:59:00Z (approx)
- **Completed:** 2026-07-16T03:05:30Z
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `getContact()`'s bookings query selected `event_types(title)` but read `.name` off the join result — always `undefined` since `event_types` has no `name` column. Fixed via `event_types(name:title)` aliasing plus a new pure `mapContactBookingRow()` helper, unit-tested for object-shaped, array-shaped, and null join results.
- Verified (by reading `scope.ts` on disk, not by re-implementing) that Phase 127-02 already shipped the `event_types.title` column fix and `{{meeting.organizer.*}}` hydration via `auth.admin.getUserById`. Extended `tests/calendar-scope.test.ts` with 2 new tests: a regression guard on the exact `event_types` select shape, and a check that `organizer.email` sources from `user.email`, not `user_metadata.email`.
- `contact-info-panel.tsx`'s booking badge ternary now has a dedicated `'showed'` case (sky-colored), no longer visually indistinguishable from `'confirmed'` — matches Plan 130-01's `bookingStatusBadgeClass()` treatment.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix the event_types(title) vs .name join bug in contact booking summaries** - `a133db61` (fix)
2. **Task 2: Verify Phase 127's scope.ts organizer-hydration fix and extend test coverage** - `dce7139e` (test)
3. **Task 3: Align the contact panel's booking badge with the 'showed' status** - `a15fe79e` (fix)

**Plan metadata:** (pending — this commit)

_Note: Task 2 was TDD-flagged in the plan but resolved as verify-only (no GREEN commit needed) since Step 1's on-disk check confirmed Phase 127-02's fix was already present — only a test-extension commit was produced, consistent with the plan's explicit VERIFY-AND-EXTEND fallback path._

## Files Created/Modified
- `src/lib/contacts/booking-summary.ts` (new) - pure `mapContactBookingRow()` mapper handling object/array/null `event_types` join shapes, extracted because `contacts/actions.ts` has `'use server'` and can only export async functions
- `tests/contacts-actions-bookings.test.ts` (new) - 3 tests: object-shaped join, array-shaped join, null `event_types` fallback
- `src/app/(dashboard)/contacts/actions.ts` - bookings query select changed from `event_types(title)` to `event_types(name:title)`; inline mapping replaced with `mapContactBookingRow()` call
- `tests/calendar-scope.test.ts` - added 2 tests (11 total, up from 127-02's 9): event_types select-shape regression guard, organizer.email source confirmation
- `src/components/chat/contact-info-panel.tsx` - booking badge ternary gained a dedicated `'showed'` case (`bg-sky-500/15 text-sky-400`)

## Decisions Made
- Task 2 confirmed both of Phase 127-02's stated deliverables were already correct on disk (`event_types` select uses `title`/`user_id`, not a nonexistent `name`; the return statement's `organizer` comes from a hydrated variable, not a hardcoded literal) — made zero production changes to `scope.ts`, only extended its test suite, per the plan's explicit instruction to avoid duplicating 127-02's already-shipped scope.
- Kept the new `describe` block in `tests/calendar-scope.test.ts` additive — did not touch or restructure any of 127-02's original 9 tests.

## Deviations from Plan

None - plan executed exactly as written, including Task 2's fallback-avoidance path (both verification checks passed, so no re-implementation was needed).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness
- SYNC-03's three read-model correctness bugs targeted by this plan are all closed: contact booking summaries show real event type names, `{{meeting.organizer.*}}` hydration is confirmed live and covered by 11 tests, and booking badges are visually consistent between the dashboard list (Plan 130-01) and the contact panel.
- `npm run build` passes; `npx vitest run tests/contacts-actions-bookings.test.ts tests/calendar-scope.test.ts tests/calendar/transition-dispatch.test.ts` is fully green (21/21).
- No blockers carried forward.

---
*Phase: 130-calendar-product-coherence*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 5 key files confirmed present on disk (`src/lib/contacts/booking-summary.ts`, `tests/contacts-actions-bookings.test.ts`, `src/app/(dashboard)/contacts/actions.ts`, `tests/calendar-scope.test.ts`, `src/components/chat/contact-info-panel.tsx`); all 3 task commits (`a133db61`, `dce7139e`, `a15fe79e`) confirmed present in git log.

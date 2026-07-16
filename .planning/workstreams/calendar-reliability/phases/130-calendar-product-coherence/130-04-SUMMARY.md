---
phase: 130-calendar-product-coherence
plan: 04
subsystem: calendar
tags: [ui, server-actions, zod, validation, react-hook-form]

# Dependency graph
requires:
  - phase: 130-calendar-product-coherence
    provides: 130-RESEARCH.md's SYNC-04 root-cause finding (event-type-form.tsx has no allowed_location_kinds field at all)
provides:
  - REACHABLE_LOCATION_KINDS / REACHABLE_LOCATION_KIND_LABELS shared constants in location-resolver.ts
  - allowed_location_kinds validated server-side on both createEventType and updateEventType
  - "Allowed meeting locations" checkbox group on the event type form (create + edit)
affects: [130-calendar-product-coherence remaining plans (130-05 google_meet wiring, 130-06 phase checkpoint), any future admin surface touching event_types.allowed_location_kinds]

# Tech tracking
tech-stack:
  added: []
  patterns: [Additive form field alongside a legacy select rather than replacing it, server action validation mirrored between create and update paths]

key-files:
  created:
    - tests/event-types-actions.test.ts
  modified:
    - src/lib/calendar/location-resolver.ts
    - src/app/(dashboard)/calendar/_actions/event-types.ts
    - src/components/calendar/event-type-form.tsx

key-decisions:
  - "Wrote the 6-kind list as a literal inline z.enum(...) array in both the server action and the client form schema (not importing the REACHABLE_LOCATION_KINDS as-const tuple into z.enum directly), per the plan's explicit guidance to avoid a TS type mismatch between z.enum's mutable-tuple signature and a readonly const array."
  - "Closed updateEventType's pre-existing zero-validation gap (it previously spread raw Partial<EventTypeInput> input straight into the .update() payload) using eventTypeSchema.partial().safeParse — this was scoped into Task 1 by the plan itself, not a deviation, since the shared form now submits to both create and edit paths."

requirements-completed: [SYNC-04]

# Metrics
duration: 12min
completed: 2026-07-16
---

# Phase 130 Plan 04: Allowed Meeting Locations Admin Control Summary

**Closed the SYNC-04 root blocker by adding a 6-option "Allowed meeting locations" checkbox group to the event type form, validated server-side on both create and edit against a new REACHABLE_LOCATION_KINDS constant that deliberately excludes zoom/whereby/store_location.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-16T03:22:00Z
- **Tasks:** 2
- **Files modified:** 3 (+ 1 test file created)

## Accomplishments
- `location-resolver.ts` now exports `REACHABLE_LOCATION_KINDS` (6-value const tuple) and `REACHABLE_LOCATION_KIND_LABELS`, scoping every downstream admin-facing consumer to only the location kinds that are fully wired end-to-end.
- `eventTypeSchema` in `event-types.ts` validates `allowed_location_kinds` against exactly those 6 kinds; `createEventType` rejects out-of-set values (e.g. `'zoom'`) and persists valid ones.
- `updateEventType` — which previously performed **zero** schema validation (it spread the raw `Partial<EventTypeInput>` straight into `.update()`) — now runs `eventTypeSchema.partial().safeParse(input)` first, closing a gap that would have let a direct call bypass the UI's checkbox group entirely.
- `event-type-form.tsx` renders a new checkbox group (additive — the legacy `location_type`/`location_value` select is untouched) offering exactly the 6 reachable kinds, seeded from `defaultValues.allowed_location_kinds` filtered to the reachable set on edit, falling back to `['custom_link']` for new event types.
- `new-event-type-dialog.tsx` and `event-type-card.tsx` needed zero changes — both already spread the form's generic `values` payload into `createEventType`/`updateEventType`, so `allowed_location_kinds` flows through automatically.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add allowed_location_kinds validation to the event-types server action (createEventType AND updateEventType)** - `45a60d07` (feat)
2. **Task 2: Add the "Allowed meeting locations" multi-select to the event type form** - `c5601c59` (feat)

**Plan metadata:** (pending — see final commit below)

## Files Created/Modified
- `src/lib/calendar/location-resolver.ts` - Adds `REACHABLE_LOCATION_KINDS`/`REACHABLE_LOCATION_KIND_LABELS` constants below the existing `LocationKind` type; no changes to resolver logic
- `src/app/(dashboard)/calendar/_actions/event-types.ts` - `allowed_location_kinds` added to `eventTypeSchema`; `updateEventType` gains `.partial().safeParse` validation
- `src/components/calendar/event-type-form.tsx` - New "Allowed meeting locations" checkbox group `FormField`, extended local `schema` and `defaultValues`
- `tests/event-types-actions.test.ts` - 5 tests: create accepts valid set, create rejects `zoom`, create still accepts `booking_type: 'round_robin'` (D-02 regression guard), update rejects `zoom`, update still accepts a valid partial (`{ title }`)

## Decisions Made
- Kept the 6-kind enum list duplicated as a literal array in three places (server schema, client schema, `REACHABLE_LOCATION_KINDS` const) per the plan's explicit instruction — `z.enum()` needs a mutable tuple and importing the `as const` readonly array directly would trip a TS error; the lists are small and the plan judged the duplication an acceptable tradeoff over the type friction.
- Followed the plan's literal code for the `defaultValues.allowed_location_kinds` seeding logic verbatim, including the non-null assertions (`defaultValues!...`) — safe because the assertions are gated behind the `?.length` truthiness check on the same filtered array immediately prior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SYNC-04 is closed: admins can now configure `allowed_location_kinds` per event type through the dashboard, scoped to the 6 kinds that actually work end-to-end.
- `zoom`, `whereby`, and `store_location` remain valid DB values for any dormant/legacy rows but are unreachable from this new control, consistent with their backend readiness per 130-RESEARCH.md.
- Manual/browser QA for the new checkbox group (create + edit flows, verifying exactly 6 options render and submit correctly) is deferred to the phase-level checkpoint in Plan 130-06, per this plan's own `<verification>` note — consistent with how Plan 130-03 handled the same deferral.
- Ready for 130-05 (google_meet wiring) and 130-06 (phase checkpoint).

---
*Phase: 130-calendar-product-coherence*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: src/lib/calendar/location-resolver.ts
- FOUND: src/app/(dashboard)/calendar/_actions/event-types.ts
- FOUND: src/components/calendar/event-type-form.tsx
- FOUND: tests/event-types-actions.test.ts
- FOUND commit: 45a60d07
- FOUND commit: c5601c59

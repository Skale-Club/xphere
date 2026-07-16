---
phase: 127-canonical-booking-lifecycle
plan: 02
subsystem: calendar
tags: [supabase, vitest, meeting-scope, workflow-variables, booking-lifecycle]

requires:
  - phase: 127-canonical-booking-lifecycle (plan 01)
    provides: emitCalendarEvent's always-service-role Supabase client (transition.ts), guaranteeing auth.admin.getUserById is always available inside buildMeetingScope
provides:
  - "buildMeetingScope (src/lib/calendar/scope.ts) selects the real event_types.title column instead of a non-existent name column that silently returned { data: null } on every call in production"
  - "meeting.organizer.{name,email} now populated from the event type's host auth user when resolvable, replacing the permanent { user_id: null, name: null, email: null } stub"
  - "tests/calendar-scope.test.ts — first-ever unit coverage for buildMeetingScope (9 tests)"
affects: [127-03, 127-04, 127-05, 127-06, 127-07, 127-08]

tech-stack:
  added: []
  patterns:
    - "organizer resolution mirrors src/app/(dashboard)/calendar/_actions/bookings.ts's resolveHostName fallback chain (user_metadata.full_name -> user_metadata.name -> null), but returns null instead of a display placeholder string since MeetingScope's organizer fields are typed string | null, not UI text"

key-files:
  created:
    - tests/calendar-scope.test.ts
  modified:
    - src/lib/calendar/scope.ts

key-decisions:
  - "MeetingScope's external field names (event_type.name, organizer.name/email) are unchanged — only their source values changed (event_types.title instead of the non-existent event_types.name column). Workflow template authors' {{meeting.*}} references remain valid with no migration needed."
  - "organizer resolution never throws — a missing user_id, a getUserById exception, or a resolved-but-null user all degrade gracefully to the same { user_id: null, name: null, email: null } shape that was the pre-fix (permanent) default, so this is a strict improvement with no new failure mode."

requirements-completed: [LIFE-04]

duration: 7min
completed: 2026-07-16
---

# Phase 127 Plan 02: Fix buildMeetingScope's event_types.title Column Bug + Organizer Stub Summary

**Fixed a silent `event_types.name` column-select bug (real column is `title`) that has made every `{{meeting.title}}`/`{{meeting.event_type.*}}` workflow variable render the literal fallback `"Meeting"` in production since the function was written, and populated `{{meeting.organizer.*}}` from the event type's host auth user via `supabase.auth.admin.getUserById`, replacing a permanent null stub.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-16T03:00:53Z
- **Completed:** 2026-07-16T03:07:47Z
- **Tasks:** 1
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- `src/lib/calendar/scope.ts`'s `event_types` select changed from `.select('id, name, slug, location_type, location_value')` (the `name` column has never existed on `event_types` — every call returned `{ data: null }` for the event type silently) to `.select('id, title, slug, location_type, location_value, user_id')`
- Every read of `eventType?.name` (the Google Calendar link title, `title`, and `event_type.name`) now reads `eventType?.title` — `meeting.title` no longer permanently renders the fallback `'Meeting'`
- Added organizer resolution: when the resolved event type has a `user_id`, `buildMeetingScope` calls `supabase.auth.admin.getUserById(eventType.user_id)` and populates `organizer.name`/`organizer.email` from the resolved user's metadata (mirroring `bookings.ts`'s `resolveHostName` fallback chain), replacing the previous hardcoded `{ user_id: null, name: null, email: null }`
- `tests/calendar-scope.test.ts` (new): 9 tests covering the title/event_type fix, 5 organizer resolution paths (full population, email-only, missing `user_id`, `getUserById` throwing, `getUserById` resolving a null user), and a full regression pass over every other `MeetingScope` field (`attendee_contact`, `location`, all timestamp derivations, `timezone`, `google_calendar_url`, `duration_minutes`, `status`, `notes`, `link`, `rescheduled_from`/`rescheduled_to`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix the event_types.title column bug + populate meeting.organizer + tests/calendar-scope.test.ts** - `01c84754` (fix)

**Plan metadata:** (pending — this commit)

## Files Created/Modified

- `src/lib/calendar/scope.ts` - `buildMeetingScope`: real `event_types.title` column select, `title`/`event_type.name`/Google Calendar link title all source from `title`, new organizer resolution block populates `organizer` from `supabase.auth.admin.getUserById`
- `tests/calendar-scope.test.ts` - first-ever unit coverage for `buildMeetingScope`, mocking `resolveMeetingLocation` and a fake `SupabaseClient` (chainable `.from(...).select(...).eq(...).single()` proxy + controllable `.auth.admin.getUserById`)

## Decisions Made

- Kept `MeetingScope`'s field names unchanged (`event_type.name`, `organizer.name`/`organizer.email`) — only the source values changed. This is a pure bug fix with zero external contract change for workflow template authors.
- `organizer.name`/`organizer.email` fall back to `null` (not a placeholder string like `resolveHostName`'s `'your host'`) since these are typed `string | null` data fields consumed by workflow templates, not UI display strings — a template author decides their own fallback text via `{{meeting.organizer.name || 'your host'}}`-style conditionals if needed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. The organizer resolution is fully wired (real `auth.admin.getUserById` call, real fallback chain) — no placeholder data flows to any consumer.

## Next Phase Readiness

- Every calendar workflow's `{{meeting.title}}`, `{{meeting.event_type.name}}`, `{{meeting.event_type.slug}}`, and `{{meeting.organizer.*}}` variables now resolve to real data on the next `emitCalendarEvent` call (no migration or backfill needed — this is a pure read-path fix, not a schema change)
- `npm run build` passes; `npx vitest run tests/calendar-scope.test.ts` is fully green (9/9)
- No blockers for 127-03 through 127-07 (the Wave 2 writer-rewiring plans) or 127-08 (the operator-gated migration 1251 apply)

---
*Phase: 127-canonical-booking-lifecycle*
*Completed: 2026-07-16*

## Self-Check: PASSED

Both key-files confirmed present on disk (`src/lib/calendar/scope.ts`, `tests/calendar-scope.test.ts`). Task commit confirmed present in git history (`01c84754`).

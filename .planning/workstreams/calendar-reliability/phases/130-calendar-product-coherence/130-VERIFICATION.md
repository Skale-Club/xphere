---
phase: 130-calendar-product-coherence
verified: 2026-07-16T04:05:00Z
status: human_needed
score: 12/13 must-have truths verified (1 is the human-browser checkpoint itself)
human_verification:
  - test: "Bookings page shows the 'showed' bucket"
    expected: "/calendar/bookings renders Upcoming/Past/Cancelled sections; a booking with status 'showed' appears in Past with a distinct sky badge; empty states render a message (not a blank page)"
    why_human: "Visual/interaction confirmation — repo has no @testing-library/react component-render infra; logic proven by unit tests"
  - test: "Calendar view bounded + refetch"
    expected: "/calendar/calendar loads only the visible week's bookings; navigating weeks/views re-fetches; cancel + new-booking dialogs refresh the visible range without a full reload"
    why_human: "Requires authenticated dashboard session + real-time navigation behavior"
  - test: "Round-robin removed"
    expected: "'New event type' dialog offers no Round robin option (single-step form, personal only)"
    why_human: "Visual confirmation of removed dialog step in a browser"
  - test: "Dead preference control removed"
    expected: "/calendar/preferences no longer shows the default location select (empty-state card in its place); page renders without errors"
    why_human: "Visual confirmation of removed settings control"
  - test: "Allowed meeting locations control"
    expected: "Event type form shows the 'Allowed meeting locations' checkbox group with exactly 6 kinds (no zoom/whereby/store location); saving persists; invalid kinds rejected"
    why_human: "Visual confirmation of the new checkbox group rendering on create + edit"
  - test: "google_meet link generation (end-to-end)"
    expected: "Creating a booking on a google_meet event type (with Google Calendar connected) produces a meeting_url on the booking/confirmation email"
    why_human: "Requires a live connected Google Calendar integration; not verifiable without external service. Wiring logic already unit-tested (Tests 14/15)"
  - test: "Contact panel booking labels"
    expected: "Contact side panel booking summaries show the real event-type title (not the generic 'Booking') and a distinct badge for showed"
    why_human: "Requires authenticated CRM session with a linked booking; visual confirmation"
---

# Phase 130: Calendar Product Coherence Verification Report

**Phase Goal:** The UI exposes only capabilities that work and calendar data displays accurately at scale.
**Verified:** 2026-07-16T04:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

Every automatable must-have across all 6 plans is VERIFIED against the on-disk code. The full phase test suite (15 files, 144 tests) is green and `npm run build` exits 0 (production build + type check, postbuild verify-sw OK). The only outstanding items are the 7 visual/interaction confirmations in `130-HUMAN-UAT.md` (status: partial), which require an authenticated browser session the autonomous orchestrator does not hold. Per the orchestrator's smoke test, the production build served /calendar, /calendar/bookings, /calendar/calendar, /calendar/preferences, /login all 200 with zero server errors.

### Observable Truths

| # | Plan | Truth | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | 130-01 | Flat bookings list loads a bounded set per section, not every booking ever | ✓ VERIFIED | `getBookingsForList` = 3× `.limit(50)` bucketed queries (bookings.ts:169-210); page consumes it (bookings/page.tsx:15). Old unbounded `getBookings()` fully removed (only comment refs remain) |
| 2 | 130-01 | A 'showed' booking appears in Past with a distinct badge instead of vanishing | ✓ VERIFIED | Past query `.in('status', ['confirmed','no_show','showed'])` (bookings.ts:187); `bookingStatusBadgeClass('showed')` → sky (booking-status.ts:43); page renders Past bucket + badge |
| 3 | 130-01 | Calendar view fetches only the visible range on load + re-fetches on navigate | ✓ VERIFIED | page passes `getBookingsForRange({from:weekStart,to:weekEnd})` (calendar/page.tsx:21); `refetchRange` useCallback re-fetches on `[view,cursor]` (calendar-view.tsx:249-266); dead `useRouter` removed (0 refs) |
| 4 | 130-02 | Contact booking panel shows real event-type name, not generic 'Booking' | ✓ VERIFIED | `.select('...event_types(name:title)')` (actions.ts:479); rows mapped via `mapContactBookingRow` (actions.ts:528, booking-summary.ts) |
| 5 | 130-02 | Organizer hydration ({{meeting.organizer.*}}) verified + test-covered | ✓ VERIFIED | scope.ts hydrates `organizer` via `auth.admin.getUserById` (line 109-117), returns hydrated variable (line 186), not a hardcoded null literal; `event_types` select uses `title`; calendar-scope.test green |
| 6 | 130-02 | Contact panel shows a distinct badge for 'showed' | ✓ VERIFIED | `b.status === 'showed'` → `bg-sky-500/15` (contact-info-panel.tsx:850-851) |
| 7 | 130-03 | New event type creates booking_type='personal', no Round robin choice | ✓ VERIFIED | Dialog submits `booking_type: 'personal'` (new-event-type-dialog.tsx:49); no user-facing round-robin label (only removal comment) |
| 8 | 130-03 | Preferences no longer shows the dead 'Meeting location' select | ✓ VERIFIED | meeting-preferences.tsx has no default_location_type/Select; preferences/page.tsx no longer calls getSchedulingProfile; backend action/type/column preserved in calendar-profile.ts (D-02) |
| 9 | 130-04 | Admin can choose meeting locations from the 6 fully-wired kinds | ✓ VERIFIED | `REACHABLE_LOCATION_KINDS` = 6 kinds (location-resolver.ts:30-37); form checkbox group maps them (event-type-form.tsx:142-149); schema validates on create + update |
| 10 | 130-04 | Location picker never offers zoom/whereby/store_location | ✓ VERIFIED | Reachable set excludes all 3; form has zero refs to them; `z.enum([...6 kinds])` in both form + action schema |
| 11 | 130-05 | google_meet booking gets a Meet link on meeting_url before confirmation email | ✓ VERIFIED | `createMeetingLink` called in `createBooking` (bookings.ts:642-666) + `createBookingInternal` (865-889) gated on `effectiveLocationKind === 'google_meet'`, before the email IIFE re-fetch; persists `meeting_url` + `google_event_id` to dedicated columns (no wholesale location_data replace) |
| 12 | 130-05 | A non-google_meet booking never calls the Meet API | ✓ VERIFIED | Both call sites guarded by the `google_meet` check; Test 15 asserts `createMeetingLink` not called for other kinds (green) |
| 13 | 130-06 | A human has confirmed in a real browser every SYNC-03/04 fix renders/behaves as claimed | ? HUMAN | Inherently a human checkpoint — 7 items in 130-HUMAN-UAT.md (status: partial), deferred per orchestrator |

**Score:** 12/13 truths verified automatically; truth 13 is the human-browser checkpoint itself.

### Required Artifacts

| Artifact | Provides | Status | Details |
| --- | --- | --- | --- |
| `src/app/(dashboard)/calendar/_actions/bookings.ts` | getBookingsForList / getBookingsForRange (bounded); google_meet meeting-link wiring | ✓ VERIFIED | Both read models exist + bounded; old getBookings gone; createMeetingLink at both create paths |
| `src/lib/calendar/booking-status.ts` | bookingStatusBadgeClass covering all 4 statuses incl. showed | ✓ VERIFIED | Reuses canonical BookingStatus union (Phase 127); neutral fallback, never throws |
| `src/app/(dashboard)/calendar/bookings/page.tsx` | Pre-bucketed sections from getBookingsForList | ✓ VERIFIED | Renders Upcoming/Past/Cancelled + empty state |
| `src/components/calendar/calendar-view.tsx` | bookingsState + refetchRange bounded fetch | ✓ VERIFIED | Wired; useRouter dead code removed |
| `src/lib/contacts/booking-summary.ts` | mapContactBookingRow (title alias, array/null-safe) | ✓ VERIFIED | Pure mapper; used by getContact |
| `src/lib/calendar/scope.ts` | organizer hydration from event_types.user_id | ✓ VERIFIED | getUserById-hydrated; title select |
| `src/components/chat/contact-info-panel.tsx` | showed badge | ✓ VERIFIED | Distinct sky case added |
| `src/components/calendar/new-event-type-dialog.tsx` | Single-step dialog, no round-robin | ✓ VERIFIED | booking_type:'personal' always |
| `src/components/calendar/meeting-preferences.tsx` | Dead default_location_type control removed | ✓ VERIFIED | Empty-state card; no Select |
| `src/lib/calendar/location-resolver.ts` | REACHABLE_LOCATION_KINDS / _LABELS (6 kinds) | ✓ VERIFIED | Excludes zoom/whereby/store_location |
| `src/app/(dashboard)/calendar/_actions/event-types.ts` | allowed_location_kinds validated on create + update | ✓ VERIFIED | createEventType safeParse; updateEventType `.partial().safeParse` |
| `src/components/calendar/event-type-form.tsx` | Allowed-locations multi-select scoped to reachable set | ✓ VERIFIED | Checkbox group; edit-mode filters out-of-set kinds |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| bookings/page.tsx | _actions/bookings.ts | getBookingsForList() | ✓ WIRED |
| calendar-view.tsx | _actions/bookings.ts | getBookingsForRange() in refetchRange | ✓ WIRED |
| calendar/page.tsx | _actions/bookings.ts | getBookingsForRange({from,to}) | ✓ WIRED |
| contacts/actions.ts | booking-summary.ts | getContact maps rows via mapContactBookingRow | ✓ WIRED |
| scope.ts | auth.admin.getUserById | organizer hydration (service-role) | ✓ WIRED |
| new-event-type-dialog.tsx | event-types.ts | createEventType({booking_type:'personal'}) | ✓ WIRED |
| event-type-form.tsx | event-types.ts | allowed_location_kinds in onSubmit payload | ✓ WIRED |
| bookings.ts | google-calendar.ts | createMeetingLink(orgId,{...}) at both create sites | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| bookings/page.tsx | upcoming/past/cancelled | getBookingsForList → 3 Supabase queries | Yes (live `bookings` table) | ✓ FLOWING |
| calendar-view.tsx | bookingsState | seeded from `bookings` prop, refreshed via getBookingsForRange | Yes | ✓ FLOWING |
| contact-info-panel bookings | event_type_name | getContact join event_types(name:title) → mapper | Yes | ✓ FLOWING |
| scope.ts organizer | organizer.{user_id,name,email} | auth.admin.getUserById(event_types.user_id) | Yes (degrades to null only on lookup failure) | ✓ FLOWING |
| meeting-preferences.tsx | (none — static empty state) | intentional removal (D-02) | N/A | ✓ (by design) |

Note: `{ upcoming: [], past: [], cancelled: [] }` in bookings/page.tsx and the `let organizer = {null,null,null}` default in scope.ts are error/degrade fallbacks overwritten by real data on the success path — not stubs.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase 130 unit + regression suite (15 files) | vitest run (15 files) | 144 passed (144) | ✓ PASS |
| Production build + type check | npm run build | exit 0, postbuild verify-sw OK | ✓ PASS |
| Old unbounded getBookings removed | grep getBookings( src/ | only comment refs | ✓ PASS |
| Meet API not called for non-meet kinds | vitest Test 15 | passing | ✓ PASS |

Regression: phases 126-129 suites (booking-validation, xkedule-webhook, calendar/lifecycle, calendar-status-vocabulary, google-calendar-busy, ghl-no-bookings-writes, calendar-tick-window, calendar-tick-route, workflow-seeds-tenant-neutral) all green within the 144-test run.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| SYNC-03 | 130-01, 130-02, 130-06 | Correct scoped read models, bounded queries, consistent state display | ✓ SATISFIED | Truths 1-6; bounded read models, join fix, organizer hydration, showed shown consistently |
| SYNC-04 | 130-03, 130-04, 130-05, 130-06 | Round-robin & structured-location controls operational or removed | ✓ SATISFIED | Truths 7-12; round-robin + default_location_type removed (data preserved), allowed_location_kinds wired to 6 reachable kinds, google_meet completed |

No orphaned requirements — REQUIREMENTS.md maps only SYNC-03..04 to Phase 130, both claimed and covered by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| scope.ts | 106 | `let organizer = { user_id: null, name: null, email: null }` | ℹ️ Info | Not a stub — degrade-to-null default, overwritten by getUserById on the success path |
| bookings/page.tsx | 18 | `{ upcoming: [], past: [], cancelled: [] }` | ℹ️ Info | Not a stub — error fallback when getBookingsForList returns !ok; real data flows on success |

No blocker or warning anti-patterns. No TODO/FIXME/placeholder markers introduced by this phase.

### Human Verification Required

7 visual/interaction confirmations persisted in `130-HUMAN-UAT.md` (status: partial) require an authenticated dashboard session. The autonomous run's production-build smoke test already confirmed all changed routes serve 200 with zero server errors; the remaining items are visual/UX and live-integration confirmations only. See the `human_verification` frontmatter block for the full list.

### Gaps Summary

No automated gaps. All 12 automatable must-have truths are VERIFIED in code, all artifacts exist/are substantive/wired/data-flowing, all key links connected, the full 15-file test suite (144 tests) is green, and `npm run build` exits 0. The single non-automatable truth (130-06: human browser confirmation) is deferred to human UAT with 7 documented test steps — treated as human_verification, not a gap, per the phase's checkpoint design and orchestrator direction.

---

_Verified: 2026-07-16T04:05:00Z_
_Verifier: Claude (gsd-verifier)_

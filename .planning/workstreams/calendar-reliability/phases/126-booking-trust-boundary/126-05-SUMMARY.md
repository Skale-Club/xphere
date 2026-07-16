---
phase: 126-booking-trust-boundary
plan: 05
subsystem: api
tags: [nextjs, server-actions, calendar, booking, vitest, security]

# Dependency graph
requires:
  - phase: 126-booking-trust-boundary (plan 01)
    provides: cancelBookingByToken remained the tested, unchanged mutation primitive this plan wires into a POST form action
provides:
  - "src/app/book/cancel/[id]/page.tsx — GET-only render + POST-only mutation via a 'use server' confirmCancel() bound to <form action={confirmCancel}>"
  - "tests/calendar-cancel-page.test.ts — automated proof that the GET render path never calls cancelBookingByToken"
affects: [126-06-apply-migrations, calendar-booking-flows, booking-emails]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "POST-mutation Server Component pattern: page renders read-only on GET; the mutation lives in an inline 'use server' closure bound as a <form action>, mirroring src/app/oauth/authorize/page.tsx"

key-files:
  created:
    - tests/calendar-cancel-page.test.ts
  modified:
    - src/app/book/cancel/[id]/page.tsx

key-decisions:
  - "Dropped the old inline errorMsg branch: since cancellation no longer happens during render, a failed POST simply re-renders the fresh booking status — self-healing, no error UI needed"
  - "confirmCancel() closes over id and token from the render scope (Next.js encrypts closed-over values in the serialized action reference), so the form needs no hidden inputs"

patterns-established:
  - "GET-safe public token pages: any emailed link (cancel/confirm/unsubscribe-style) must render state on GET and gate the mutation behind a form-action POST"

requirements-completed: [CAL-03]

# Metrics
duration: 18min
completed: 2026-07-16
---

# Phase 126 Plan 05: Public Cancellation GET/POST Split Summary

**The public booking-cancellation page no longer mutates on GET — link-preview crawlers (Slack/WhatsApp/Outlook Safe Links) can unfurl the emailed cancel URL harmlessly, and cancellation now requires an explicit "Cancel booking" POST via a Server Action bound to the existing cancel_token.**

## Performance

- **Duration:** ~18 min (execution) + human-verify checkpoint wait
- **Started:** 2026-07-16T01:28:00Z
- **Completed:** 2026-07-16T01:45:00Z
- **Tasks:** 3 (2 auto TDD + 1 human-verify checkpoint, approved)
- **Files modified:** 2 (1 new test, 1 refactored page)

## Accomplishments
- Closed the CAL-03 gap: `src/app/book/cancel/[id]/page.tsx` previously called `cancelBookingByToken()` inline in its Server Component render, so any bot fetching the cancel URL from the confirmation email silently cancelled the booking.
- GET render now performs exactly two read-only lookups (`bookings`, `event_types`) and shows a confirmation screen ("Cancel this booking?") for confirmed bookings or "Already cancelled" for cancelled ones.
- The actual mutation lives in an inline `'use server'` function `confirmCancel()` bound to `<form action={confirmCancel}>` — only executes on the browser's POST form submission, mirroring the in-repo precedent at `src/app/oauth/authorize/page.tsx`.
- New automated test proves GET never mutates: pending booking, already-cancelled booking, and missing-token (`notFound()`) cases all assert `cancelBookingByToken` is never called during render.
- Human checkpoint verified end-to-end in a real browser against a production-build server: GET leaves `status='confirmed'`, clicking the button flips it to `'cancelled'`, revisiting the link is idempotent.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Write the automated GET-never-mutates test (RED)** - `e3923359` (test)
2. **Task 2: Refactor cancel page to GET-renders / POST-mutates (GREEN)** - `c16fec52` (feat)
3. **Task 3: Manual browser verification** - checkpoint approved by operator (no code changes)

**Plan metadata:** _(this commit)_

_No REFACTOR commit — the GREEN implementation matched the plan's target code exactly, nothing to clean up._

## Files Created/Modified
- `tests/calendar-cancel-page.test.ts` - Mock-based proof that the page component's GET render path never calls `cancelBookingByToken` (3 tests)
- `src/app/book/cancel/[id]/page.tsx` - GET-only render + `confirmCancel` Server Action POST mutation; `cancelBookingByToken(id, token)` appears exactly once, inside the action

## Decisions Made
- Followed the plan's target implementation verbatim (it was fully specified). The inline `errorMsg` display branch from the old page was dropped as planned — a failed POST (e.g. concurrent cancel) just re-renders the fresh booking status.
- For the checkpoint verification environment, served the already-built production output via `npx next start -p 4267` instead of `npm run dev` (see Issues Encountered), and seeded a clearly-marked synthetic booking rather than clicking through the public booking flow — faster, and avoided touching any real tenant flow.

## Deviations from Plan

None - plan executed exactly as written. (The checkpoint-environment workaround below affected only how the verification server was started, not any planned artifact.)

## Issues Encountered
- **Turbopack dev server crashes in this isolated worktree:** `npm run dev` fails with `TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root` — the worktree's `node_modules` is a Windows junction into the main repo, which Turbopack refuses to resolve. Worked around by serving the Task 2 production build with `npx next start -p 4267` for the human-verify checkpoint. Not a product issue; affects only dev-server usage inside gsd worktrees.
- **Checkpoint test data:** created a synthetic booking (`GSD-VERIFY-126-05`, `.invalid` email, year-2099 date) directly in the `bookings` table for the click-through, verified GET-no-mutation programmatically first, and deleted the row after approval. Zero residue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CAL-03 closed. Remaining in Phase 126: 126-02 (MCP bookings_create wiring, CAL-01) and 126-06 (operator checkpoint to apply migrations 1249+1250 to production).
- The refactored page keeps `cancelBookingByToken` untouched, so 126-06 and Phase 127 (canonical lifecycle) inherit no new coupling from this plan.

---
*Phase: 126-booking-trust-boundary*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: tests/calendar-cancel-page.test.ts
- FOUND: src/app/book/cancel/[id]/page.tsx
- FOUND commit: e3923359 (test)
- FOUND commit: c16fec52 (feat)

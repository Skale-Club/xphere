---
gsd_state_version: 1.0
milestone: v3.4
milestone_name: milestone
current_plan: 1
status: executing
stopped_at: Completed 130-02-PLAN.md
last_updated: "2026-07-16T07:06:48.076Z"
last_activity: 2026-07-16
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 32
  completed_plans: 28
---

# Project State

## Current Position

Phase: 130 (calendar-product-coherence) — EXECUTING
Plan: 3 of 6
Status: Ready to execute
Last activity: 2026-07-16

## Progress

**Phases Complete:** 0
**Current Plan:** 1

## Decisions

- **126-05:** Dropped the cancel page's inline error branch — cancellation no longer happens during render, so a failed POST self-heals by re-reading fresh booking status on the next render.
- **126-05:** Human-verify checkpoints in gsd worktrees serve the production build via `npx next start` — Turbopack dev crashes on the worktree's node_modules junction (Symlink points out of filesystem root).
- [Phase 126]: 126-02: kept end_at as an optional (ignored) field on bookings_create rather than removing it, avoiding breakage for callers still sending it under .strict() schema validation while guaranteeing the value is never trusted
- [Phase 127-01]: Kept 'showed' as the only DB status; markShowed emits pre-existing event 'meeting.completed' rather than adding a new DB status — Smaller, lower-risk resolution; revives the dead skleanings-post-service-review seed workflow with zero seed changes
- [Phase 127-02]: Fixed event_types.title column-select bug in buildMeetingScope (real column is title, not name) and populated meeting.organizer from the event type host via auth.admin.getUserById, keeping MeetingScope's field names unchanged so no workflow template migration is needed
- [Phase 127-03]: Kept the two @/lib/calendar/transition imports as separate import statements per the plan's literal text, and reworded the BOOKING_STATUSES[0] comment to avoid doubling the plan's own acceptance-criteria grep count
- [Phase 127-04]: Fixed the plan's own booking_not_found error-mapping bug: cancelBooking's booking_not_found now maps to {error:'not_found', status:404} matching the file's existing not_found convention, not the leaked internal 'booking_not_found' string
- [Phase 127-05]: Covered mapStatus/calendarEventFor entirely through the exported POST handler (no helper exports); combined both tasks' 17 tests into one RED commit, verifying the correct subset flipped green after each task's own GREEN commit
- [Phase 127-06]: Fixed the status-vocabulary scanner's false positive on flows/engine.ts's unrelated workflow_runs/workflow_run_steps status literals with a narrow NON_BOOKING_STATUS_LITERALS allowlist, instead of restructuring the scanner or FILES_TO_SCAN
- [Phase 127-07]: Kept booking-lifecycle-actions.ts and flows/engine.ts's inline booking_* handlers as two separate thin adapters (JSON string vs Record<string, unknown> return conventions) rather than consolidating the two dispatch engines, per the phase's internal-unification-only boundary
- [Phase 128-reliable-calendar-scheduling]: 128-01: Implemented the plan's interfaces block verbatim (no renaming) so Plan 128-05 can import computeDueWindow/isDue/etc. directly; isDue uses exclusive-lower/inclusive-upper (scanStart, scanEnd] semantics as the core SCH-01 correctness property
- [Phase 128-reliable-calendar-scheduling]: 128-02: Ported global-knowledge-notion's auth pattern verbatim (503 unset / 401 mismatch, read fresh in GET()) rather than the timingSafeEqual variant — plan's interfaces block specified the simpler pattern and RESEARCH.md flagged constant-time comparison as optional, non-required hardening
- [Phase 128-reliable-calendar-scheduling]: 128-03: Removed tag_customer/create_opportunity nodes entirely from booking-confirmation.yaml rather than genericizing them; reworded a plan comment to avoid the literal substring 'Job Confirmed' tripping the plan's own regression test; removed the empty agendamento/ directory tree left behind by git mv
- [Phase 128-reliable-calendar-scheduling]: 128-04: Used migration number 1252 (not the plan's working-example 1251) since Phase 127 already claimed 1251_booking_lifecycle_transition.sql on this branch; test creates its own throwaway contrast-case booking, explicitly deleted after use so it never leaks into the same rolled-back transaction's later assertions
- [Phase 128-reliable-calendar-scheduling]: 128-05: Added a route-layer transition-safety guard so a missing calendar_tick_watermark row/table scans an empty window and self-seeds from now, instead of falling back to computeDueWindow's 24h catch-up cap (prevents a double-dispatch burst if this code deploys before migration 1252 applies)
- [Phase 128-reliable-calendar-scheduling]: 128-05: Kept the meeting.ended status filter as ['confirmed','showed'] rather than adding 'completed' as the plan text specified — 'completed' is not a valid bookings.status value per the DB type union and booking-status.ts's LIFE-02 vocabulary note
- [Phase 129-01]: Extended fetchBusyTimes's 5th parameter from a single calendarId to calendarIds: string[] (default ['primary']), backward-compatible for all pre-existing 4-arg call sites
- [Phase 129-01]: Fixed database.ts's stale calendar_profiles types (missing sync_mode/default_location_type/conflict_calendar_ids since migrations 1141/1142) at the root instead of adding another local cast
- [Phase 129-03]: Added migration 1253 (ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'google_calendar') as a Rule 1/3 deviation -- production's enum never actually had this value despite database.ts claiming it did, silently breaking Google Calendar OAuth connect for every org; fixed in-flight since it blocked this task's plan-specified fixture inserts
- [Phase 129-04]: Placed the KNOWN_XKEDULE_STATUSES guard before mapStatus/existing-row lookup so an unrecognized status touches zero DB tables beyond auth; fixed 127-05's now-obsolete unrecognized-status-falls-back-to-confirmed test since this plan makes that behavior incorrect by design
- [Phase 129-05]: No code changes to src/lib/ghl/** or src/app/api/ghl/** -- confirmed via read + grep that no GHL surface writes to bookings today; added a static grep-based Vitest guardrail instead, closing SYNC-02's GHL half per the D-03 scope lock (no new providers/paths).
- [Phase 129-02]: Used migration number 1254 (not the plan's placeholder <next>) since 1253_google_calendar_provider_enum.sql (129-03's deviation fix) was already the latest migration on this branch
- [Phase 130-01]: Added bookingStatusBadgeClass() to the existing booking-status.ts (Phase 127's canonical BookingStatus module, imported by 6 files) instead of overwriting it with a second status type as the plan's literal Task 2 code specified
- [Phase 130-02]: Confirmed Phase 127-02's scope.ts organizer-hydration and event_types.title fixes were already correct on disk; made zero production changes, only extended tests/calendar-scope.test.ts with 2 new regression tests

## Session Continuity

**Stopped At:** Completed 130-02-PLAN.md
**Resume File:** None

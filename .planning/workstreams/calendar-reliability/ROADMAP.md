# Roadmap: Xphere v3.4 Calendar Reliability & Workflow Integrity

## Overview

This milestone makes calendar behavior trustworthy from public booking through workflow automation and provider mirroring. It implements the audit findings in dependency order: integrity first, then lifecycle, scheduler, integrations, and finally product/read-model completion.

## Phases

- [x] **Phase 126: Booking Trust Boundary** - Make availability, conflict validation, cancellation, and calendar RLS server-authoritative. (CAL-01..04) (completed 2026-07-16)
- [ ] **Phase 127: Canonical Booking Lifecycle** - Unify status transitions, workflow events, and payload contracts. (LIFE-01..04)
- [ ] **Phase 128: Reliable Calendar Scheduling** - Repair reminder timing, idempotency, cron security, and neutral defaults. (SCH-01..04)
- [ ] **Phase 129: Provider Synchronization Integrity** - Align Google, Xkedule, and GHL with lifecycle and provider ownership semantics. (SYNC-01..02)
- [ ] **Phase 130: Calendar Product Coherence** - Complete or remove exposed unfinished controls and correct scoped read models. (SYNC-03..04)

## Phase Details

### Phase 126: Booking Trust Boundary
**Goal**: No client can create an invalid or conflicting booking, and public cancellation cannot mutate state on GET.
**Depends on**: Nothing
**Requirements**: CAL-01, CAL-02, CAL-03, CAL-04
**Success Criteria**:
1. Booking creation validates a server-derived slot and rejects overlap or malformed intervals.
2. A database constraint prevents overlapping active appointments for an organizer.
3. Cancellation requires a deliberate POST action with an unguessable token.
4. Calendar database policies no longer allow anonymous broad reads/writes.

**Plans:** 6/6 plans complete

Plans:
- [x] 126-01-PLAN.md — Shared resolveAndValidateSlot helper + createBooking wiring (CAL-01)
- [x] 126-02-PLAN.md — MCP bookings_create tool wiring to the shared helper (CAL-01)
- [x] 126-03-PLAN.md — Organizer overlap guard migration (1249) + real-DB test (CAL-02)
- [x] 126-04-PLAN.md — Calendar RLS least-privilege migration (1250) + real-DB test (CAL-04)
- [x] 126-05-PLAN.md — Public cancellation GET/POST split (CAL-03)
- [x] 126-06-PLAN.md — Operator checkpoint: apply migrations 1249+1250 to production (CAL-02, CAL-04)

### Phase 127: Canonical Booking Lifecycle
**Goal**: All booking writers use one tested state transition and event emission service.
**Depends on**: Phase 126
**Requirements**: LIFE-01, LIFE-02, LIFE-03, LIFE-04

**Plans:** 8 plans

Plans:
- [ ] 127-01-PLAN.md — Canonical transition_booking_status RPC (migration 1251) + rewritten transition.ts (org-scoped, adds markShowed) + lifecycle/vocabulary tests (LIFE-01, LIFE-02)
- [ ] 127-02-PLAN.md — Fix buildMeetingScope's event_types.title column bug + populate meeting.organizer (LIFE-04)
- [ ] 127-03-PLAN.md — Native dashboard/public writer wiring (cancelBooking, cancelBookingByToken) to the canonical service (LIFE-01, LIFE-03)
- [ ] 127-04-PLAN.md — MCP bookings_cancel wiring to the canonical service (LIFE-01, LIFE-03)
- [ ] 127-05-PLAN.md — Xkedule webhook: completed→showed mapping + no-event-after-failed-write fix (LIFE-02, LIFE-03)
- [ ] 127-06-PLAN.md — Durable workflow engine (flows/engine.ts) booking_* action nodes wired to the canonical service (LIFE-01, LIFE-02, LIFE-03)
- [ ] 127-07-PLAN.md — Wait-free engine (execute-action.ts) booking_* mirror + update_booking_status guard fix (LIFE-01, LIFE-03)
- [ ] 127-08-PLAN.md — Operator checkpoint: apply migration 1251 to production (LIFE-01)

### Phase 128: Reliable Calendar Scheduling
**Goal**: Reminder workflows run at their configured offset exactly once despite cron delay.
**Depends on**: Phase 127
**Requirements**: SCH-01, SCH-02, SCH-03, SCH-04

**Plans:** 6 plans

Plans:
- [ ] 128-01-PLAN.md — Pure watermark-window/dedup-key/stale-skip/watermark-guard functions + unit tests (SCH-01, SCH-02)
- [ ] 128-02-PLAN.md — Mandatory CRON_SECRET check on the calendar-tick endpoint + route auth test (SCH-03)
- [ ] 128-03-PLAN.md — Neutralize booking-confirmation.yaml + relocate Skleanings-only example workflows + regression test (SCH-04)
- [ ] 128-04-PLAN.md — calendar_tick_watermark migration + real-DB dedup/watermark test (SCH-01, SCH-02, SCH-03)
- [ ] 128-05-PLAN.md — Wire watermark-bounded scan + offset-derived dedup key into the live route (SCH-01, SCH-02, SCH-03)
- [ ] 128-06-PLAN.md — Operator checkpoint: apply the watermark migration to production (SCH-01, SCH-02, SCH-03)

### Phase 129: Provider Synchronization Integrity
**Goal**: Provider connections and statuses preserve tenant isolation and calendar lifecycle semantics.
**Depends on**: Phase 127
**Requirements**: SYNC-01, SYNC-02

### Phase 130: Calendar Product Coherence
**Goal**: The UI exposes only capabilities that work and calendar data displays accurately at scale.
**Depends on**: Phases 126, 127, 129
**Requirements**: SYNC-03, SYNC-04

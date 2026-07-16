# Roadmap: Xphere v3.4 Calendar Reliability & Workflow Integrity

## Overview

This milestone makes calendar behavior trustworthy from public booking through workflow automation and provider mirroring. It implements the audit findings in dependency order: integrity first, then lifecycle, scheduler, integrations, and finally product/read-model completion.

## Phases

- [ ] **Phase 126: Booking Trust Boundary** - Make availability, conflict validation, cancellation, and calendar RLS server-authoritative. (CAL-01..04)
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

### Phase 127: Canonical Booking Lifecycle
**Goal**: All booking writers use one tested state transition and event emission service.
**Depends on**: Phase 126
**Requirements**: LIFE-01, LIFE-02, LIFE-03, LIFE-04
**Success Criteria**:
1. Confirm, cancel, no-show, showed, complete, and reschedule states have one valid contract.
2. No caller emits a calendar event when its database update fails.
3. Native, flow, MCP, and webhook paths produce consistent events.
4. Workflow variables match the documented calendar trigger contract.

### Phase 128: Reliable Calendar Scheduling
**Goal**: Reminder workflows run at their configured offset exactly once despite cron delay.
**Depends on**: Phase 127
**Requirements**: SCH-01, SCH-02, SCH-03, SCH-04
**Success Criteria**:
1. Delayed ticks recover the whole missed window safely.
2. Each due workflow/offset is selected and dispatched once.
3. Tick routes fail closed without a configured secret.
4. New tenant defaults contain no client-specific business automation.

### Phase 129: Provider Synchronization Integrity
**Goal**: Provider connections and statuses preserve tenant isolation and calendar lifecycle semantics.
**Depends on**: Phase 127
**Requirements**: SYNC-01, SYNC-02
**Success Criteria**:
1. Google busy checks use selected conflict calendars and native bookings retain external identifiers.
2. Calendar provider ownership is explicit and protected from unauthorized credential replacement.
3. Xkedule completion/cancellation and GHL-created appointments map to correct lifecycle behavior.

### Phase 130: Calendar Product Coherence
**Goal**: The UI exposes only capabilities that work and calendar data displays accurately at scale.
**Depends on**: Phases 126, 127, 129
**Requirements**: SYNC-03, SYNC-04
**Success Criteria**:
1. Scopes return event type and organizer information correctly, with bounded booking queries.
2. All supported booking states appear consistently in calendar/list views and timezone presentation is coherent.
3. Round-robin and structured locations function end-to-end or are hidden until implemented.

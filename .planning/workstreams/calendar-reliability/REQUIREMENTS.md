# Requirements: Xphere v3.4 Calendar Reliability & Workflow Integrity

**Defined:** 2026-07-15
**Core Value:** The Action Engine must execute the correct tenant action reliably; calendar lifecycle events are part of that contract.

## v3.4 Requirements

### Trusted Booking

- [x] **CAL-01**: A public or programmatic booking is accepted only when its event type is active, its time is valid and available, and its interval is conflict-free in the tenant calendar.
- [x] **CAL-02**: The database prevents invalid booking intervals and overlapping active bookings for the same organizer, including bookings from different event types.
- [x] **CAL-03**: Public cancellation requires an explicit POST confirmation and cannot be triggered by a link preview or crawler.
- [x] **CAL-04**: Calendar tables enforce least-privilege RLS policies; privileged service-role paths remain explicit.

### Lifecycle and Workflows

- [x] **LIFE-01**: Every booking status transition uses one canonical service with valid state guards, transactional persistence, and one matching calendar event.
- [x] **LIFE-02**: The booking data model and all callers agree on supported states, including completion/showed semantics.
- [x] **LIFE-03**: Native booking, MCP, workflow actions, and Xkedule inbound updates trigger the same lifecycle contract without emitting events after failed writes.
- [x] **LIFE-04**: Calendar workflow payloads expose documented meeting, event, and trigger-offset variables consistently.

### Scheduled Automation

- [x] **SCH-01**: Calendar reminders tolerate delayed cron invocations without losing due bookings.
- [x] **SCH-02**: A scheduler dispatches only the workflow and offset that are due, once per booking/workflow/offset.
- [ ] **SCH-03**: The calendar tick endpoint requires a configured secret and records durable scheduling progress.
- [ ] **SCH-04**: Platform defaults are tenant-neutral and never install Skleanings-specific tagging, opportunities, or email content for every organization.

### Provider and Product Coherence

- [ ] **SYNC-01**: Google calendar configuration has an explicit organization ownership model, honors selected conflict calendars, and stores external event identifiers for lifecycle synchronization.
- [ ] **SYNC-02**: Xkedule and GHL booking paths preserve provider status semantics and use the canonical lifecycle/event path.
- [ ] **SYNC-03**: Calendar scope and read models return correct event-type and organizer data, use bounded queries, and display all supported states consistently.
- [ ] **SYNC-04**: Round-robin and structured-location controls are either operational end-to-end or removed from customer-facing configuration.

## Future Requirements

- **CAL-F01**: Operator tooling to migrate or deactivate pre-existing client-specific seeded workflows after tenant review.
- **CAL-F02**: Full bidirectional Google event edit/delete reconciliation and reconciliation jobs for missed provider webhooks.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automatic mutation of existing tenant workflows | Could change live customer automations and requires an operator-approved migration. |
| New scheduling providers | Reliability of existing native, Google, Xkedule, and GHL paths comes first. |
| Replacing the workflow engine | The shared workflow runtime is retained; calendar must conform to it. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAL-01..04 | Phase 126 | Pending |
| LIFE-01..04 | Phase 127 | Pending |
| SCH-01..04 | Phase 128 | Pending |
| SYNC-01..02 | Phase 129 | Pending |
| SYNC-03..04 | Phase 130 | Pending |

**Coverage:** 15 v3.4 requirements, 15 mapped, 0 unmapped.

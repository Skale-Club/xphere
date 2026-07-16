# Phase 127: Canonical Booking Lifecycle - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — orchestrator picked recommended defaults from the calendar audit)

<domain>
## Phase Boundary

All booking status transitions flow through one canonical, tested lifecycle service that guards valid state transitions, persists transactionally, and emits exactly one matching calendar workflow event per successful transition. Every booking writer — native server actions, MCP tools, workflow actions, and Xkedule inbound updates — uses this contract. No events are emitted after failed writes.
</domain>

<decisions>
## Implementation Decisions

### D-01: One canonical transition service
- A single module (e.g. `src/lib/calendar/lifecycle.ts`) owns booking status transitions. It validates the current→next transition against an explicit state machine, performs the write, and emits the corresponding calendar event only after the write succeeds.
- All writers (native `createBooking`/`cancelBookingByToken`, MCP booking tools, workflow actions, Xkedule inbound) are refactored to call it. No writer updates `bookings.status` directly anymore.

### D-02: Agreed state model
- The booking data model and all callers must agree on supported states, including completion/"showed" semantics (migration 1224 added `showed`). The state machine must document every state and legal transition; illegal transitions return typed errors, never silent no-ops that still emit events.

### D-03: Event emission contract
- Exactly one calendar event per successful transition (created/cancelled/rescheduled/completed/showed etc.). Emission happens after persistence, never before; failed writes emit nothing.
- Event payloads follow one documented shape (LIFE-04): meeting fields, event fields, and trigger-offset variables exposed consistently for workflow consumption.

### D-04: Compatibility
- Do not change public API shapes or webhook contracts of existing endpoints; this is an internal unification. Xkedule mirror semantics (external_source rows) are preserved.

### Claude's Discretion
- Exact module layout, naming, and whether to use a transition table vs. switch-based guard.
- How to structure transactional persistence given Supabase client constraints (RPC vs. sequential writes with compensations) — pick the smallest reliable approach consistent with existing patterns.
</decisions>

<code_context>
## Existing Code Insights

To be gathered during research — key entry points known from Phase 126 work:
- `src/app/(dashboard)/calendar/_actions/bookings.ts` (native create/cancel)
- `src/lib/mcp/tools/bookings.ts` (MCP tools)
- `src/app/api/xkedule/webhook/route.ts` (Xkedule inbound)
- Workflow engine calendar actions (see `src/lib/action-engine/` and workflow docs)
- Migration `1224_booking_status_showed.sql` (status vocabulary)
</code_context>

<specifics>
## Specific Ideas

- Phase 126 added `resolveAndValidateSlot` (`src/lib/calendar/booking-validation.ts`) — the lifecycle service is its sibling: validation at the entry boundary, lifecycle at the transition boundary.
- Requirements: LIFE-01 (canonical service), LIFE-02 (agreed states incl. showed/completed), LIFE-03 (all writers use it, no events after failed writes), LIFE-04 (documented payload variables).
</specifics>

<deferred>
## Deferred Ideas

- Provider synchronization details (Google/GHL) belong to Phase 129.
- Reminder scheduling belongs to Phase 128.
</deferred>

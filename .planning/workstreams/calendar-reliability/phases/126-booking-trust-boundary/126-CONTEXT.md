# Phase 126: Booking Trust Boundary - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated from the calendar audit requested by the operator

<domain>
## Phase Boundary

Make every booking write server-authoritative and safe. Public booking must validate against real availability and database conflict rules; public cancellation must require an explicit POST action; calendar RLS must use least privilege.
</domain>

<decisions>
## Implementation Decisions

### D-01: Server-authoritative availability
- Public and programmatic booking creation must derive `end_at` from the active event type and validate the requested UTC start against the same availability/conflict logic used to display slots.

### D-02: Durable overlap protection
- The database must reject malformed intervals and overlapping active bookings for the same organizer, even where event types differ. Cancelled bookings must not block a replacement slot.

### D-03: Safe cancellation
- Opening a cancellation URL must render a confirmation page only. The state mutation must be a POST server action protected by the existing cancellation token.

### D-04: RLS boundary
- Remove broad public calendar RLS access. Public booking flows use narrowly scoped service-role code; normal authenticated reads/writes remain tenant-scoped.

### the agent's Discretion
- Choose the smallest compatible PostgreSQL exclusion/check-constraint approach and maintain compatibility with existing booking data.
</decisions>

<canonical_refs>
## Canonical References

- `src/app/(dashboard)/calendar/_actions/bookings.ts` - native booking and cancellation server actions.
- `src/lib/calendar/slots.ts` - canonical available-slot computation.
- `src/app/book/cancel/[id]/page.tsx` - public cancellation GET behavior to replace.
- `supabase/migrations/071_scheduling.sql` - initial scheduling schema/RLS.
- `supabase/migrations/073_scheduling_hardening.sql` - existing booking uniqueness hardening.
- `tests/calendar-slots.test.ts` and `tests/calendar-bookings.test.ts` - calendar test baseline.
</canonical_refs>

<deferred>
## Deferred Ideas

- Existing tenant workflow migration is explicitly out of scope for this phase.
- Provider synchronization and booking lifecycle event unification belong to later phases.
</deferred>

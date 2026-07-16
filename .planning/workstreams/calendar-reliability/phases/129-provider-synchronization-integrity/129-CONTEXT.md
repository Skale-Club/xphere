# Phase 129: Provider Synchronization Integrity - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — orchestrator picked recommended defaults from the calendar audit)

<domain>
## Phase Boundary

Provider connections (Google Calendar, Xkedule, GHL) preserve tenant isolation and calendar lifecycle semantics. Google configuration has an explicit org ownership model, honors selected conflict calendars, and stores external event identifiers for lifecycle sync. Xkedule and GHL booking paths preserve provider status semantics and route through the canonical lifecycle service from Phase 127.
</domain>

<decisions>
## Implementation Decisions

### D-01: Google org ownership (SYNC-01)
- Google calendar configuration rows must be explicitly owned by an organization (org_id column / scoping), not implicitly resolved. Access respects tenant isolation (RLS scoped to org member).
- Conflict-calendar selection made in settings must actually be honored by availability/busy computation (migration 1142 added conflict calendars — verify the selection is used end-to-end, fix if ignored).
- Bookings synced to Google must store the external Google event id on the booking (or a link table) so cancel/reschedule can propagate later (lifecycle synchronization foundation; full bidirectional reconciliation is CAL-F02, out of scope).

### D-02: Xkedule/GHL lifecycle conformance (SYNC-02)
- Xkedule inbound updates and GHL booking paths must use the Phase 127 canonical lifecycle service — same transitions, same events, no direct status writes.
- Provider status semantics preserved: external/mirrored rows keep their provider-owned status vocabulary mapped explicitly to the canonical states; no silent coercion.

### D-03: Non-goals
- No new providers. No full bidirectional Google edit/delete reconciliation (CAL-F02). No mutation of existing tenant workflows.

### Claude's Discretion
- Schema shape for external event identifiers (column vs. link table) — pick smallest compatible with existing google sync code.
- How to model org ownership migration for existing Google connection rows (backfill strategy).
</decisions>

<code_context>
## Existing Code Insights

To be gathered during research — known starting points:
- Google calendar integration code (search src/lib for google calendar client/busy/sync)
- Migration 1142_scheduling_conflict_calendars.sql
- src/app/api/xkedule/webhook/route.ts and migration 1212_xkedule_booking_mirror.sql
- GHL integration in src/lib/ghl/
- Phase 127 lifecycle service (will exist by execution time — src/lib/calendar/lifecycle.ts or similar)
</code_context>

<specifics>
## Specific Ideas

- Requirements: SYNC-01 (Google org ownership + conflict calendars honored + external event ids stored), SYNC-02 (Xkedule/GHL preserve provider status semantics and use canonical lifecycle/event path).
- Phase 126 added organizer_user_id + overlap constraint exempting external_source rows — provider mirror rows must keep working.
</specifics>

<deferred>
## Deferred Ideas

- Full bidirectional Google event edit/delete reconciliation and missed-webhook reconciliation jobs (CAL-F02).
- UI coherence work (Phase 130).
</deferred>

# Phase 130: Calendar Product Coherence - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — orchestrator picked recommended defaults from the calendar audit)

<domain>
## Phase Boundary

The calendar UI exposes only capabilities that actually work end-to-end, and calendar read models return correct data at scale. Round-robin and structured-location controls are either made operational or removed from customer-facing configuration. Scoped read models return correct event-type/organizer data with bounded queries and consistent state display.
</domain>

<decisions>
## Implementation Decisions

### D-01: Correct scoped read models (SYNC-03)
- Calendar scope/read models must return correct event-type and organizer data (no wrong joins/fallbacks), use bounded queries (pagination/limits — no unbounded selects that degrade at scale), and display all supported booking states consistently (including showed/completed semantics from Phase 127).

### D-02: Operational-or-removed controls (SYNC-04)
- For each exposed-but-unfinished control (round-robin assignment, structured location kinds, anything else research identifies): decide per control — if it can be completed end-to-end with modest effort, complete it; otherwise REMOVE it from customer-facing configuration (hide/disable with data preserved). Default bias: remove rather than half-support. Document each decision.

### D-03: No regressions
- UI changes must not break existing booking flows validated in Phases 126-129. `npm run build` green; existing tests keep passing.

### Claude's Discretion
- Per-control complete-vs-remove decisions, guided by the effort/robustness tradeoff and what Phases 126-129 already hardened.
- Pagination strategy for read models (cursor vs offset) consistent with existing dashboard patterns.
</decisions>

<code_context>
## Existing Code Insights

To be gathered during research — known starting points:
- src/lib/calendar/scope.ts (scoped read models)
- Calendar dashboard pages/components (src/app/(dashboard)/calendar/, src/components/calendar/)
- Migrations 089/090 (location kinds), event_types round-robin fields (search schema)
- Booking states vocabulary finalized in Phase 127
</code_context>

<specifics>
## Specific Ideas

- Requirements: SYNC-03 (correct scoped read models, bounded queries, consistent states), SYNC-04 (round-robin and structured-location controls operational end-to-end or removed from customer-facing configuration).
- This phase depends on 126, 127, 129 — read their SUMMARYs before planning.
</specifics>

<deferred>
## Deferred Ideas

- New scheduling providers, workflow engine changes (out of scope for the milestone).
</deferred>

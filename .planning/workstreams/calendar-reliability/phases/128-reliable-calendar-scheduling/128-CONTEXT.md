# Phase 128: Reliable Calendar Scheduling - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous run — orchestrator picked recommended defaults from the calendar audit)

<domain>
## Phase Boundary

Calendar reminder workflows fire at their configured offset exactly once per booking/workflow/offset, even when cron invocations are delayed or missed. The calendar tick endpoint is secret-protected and records durable scheduling progress. Platform defaults are tenant-neutral.
</domain>

<decisions>
## Implementation Decisions

### D-01: Delay-tolerant due-window scan (SCH-01)
- The scheduler must select bookings whose reminder time falls in a window derived from durable progress (last processed watermark or per-item dispatch records), not "now ± tick interval". A late cron run still picks up everything that became due since the last successful run.

### D-02: Exactly-once dispatch (SCH-02)
- Deduplication is durable: one dispatch per (booking, workflow, offset). Use a dispatch-log table or unique constraint so retries and overlapping ticks cannot double-fire. Only the workflow/offset that is actually due is dispatched.

### D-03: Secured tick endpoint with durable progress (SCH-03)
- The calendar tick endpoint requires a configured secret (reject when missing/mismatched — follow the existing cron endpoint secret pattern in the repo, e.g. the campaign tick). Progress is persisted so restarts/redeploys don't lose position.

### D-04: Tenant-neutral defaults (SCH-04)
- Platform-default calendar workflows/seeds must not install client-specific (Skleanings) tagging, opportunities, or email content for every org. Defaults become neutral; anything client-specific moves to that tenant's own workflow configuration. NOTE (from REQUIREMENTS Out of Scope): do NOT auto-mutate existing tenant workflows — only change what new orgs/platform seeds install going forward. Existing-tenant migration is CAL-F01 (future).

### Claude's Discretion
- Watermark vs. per-item dispatch-log design (pick the one that composes best with the existing schema and the Phase 127 lifecycle events).
- Whether the tick runs via GitHub Actions cron (existing pattern: .github/workflows/*tick*) or another scheduler — keep the existing transport, fix the semantics.
</decisions>

<code_context>
## Existing Code Insights

To be gathered during research — known starting points:
- Calendar reminder/tick code paths (search for calendar tick/reminder in src/app/api/cron/ and src/lib/)
- `.github/workflows/` cron tick workflows (campaign-tick exists as a reference pattern with secret)
- Workflow engine trigger-offset handling (ties into LIFE-04 payload variables from Phase 127)
- Platform seed workflows in `supabase/seeds/workflows/`
</code_context>

<specifics>
## Specific Ideas

- Requirements: SCH-01 (cron-delay tolerance), SCH-02 (exactly-once per booking/workflow/offset), SCH-03 (secret + durable progress), SCH-04 (tenant-neutral defaults).
- Phase 127 (canonical lifecycle) runs before this phase — reminders should consume its event/payload contract where applicable.
</specifics>

<deferred>
## Deferred Ideas

- Operator tooling to migrate pre-existing client-specific seeded workflows (CAL-F01, future requirement).
- Provider sync (Phase 129), UI coherence (Phase 130).
</deferred>

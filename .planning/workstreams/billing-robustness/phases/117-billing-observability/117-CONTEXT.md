# Phase 117: Billing Observability - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

When billing fails — a Stripe webhook errors, or a credit debit silently fails open — the platform admin can see it happened without querying the database directly.

</domain>

<decisions>
## Implementation Decisions

### Reuse Existing Observability Infrastructure (key architectural decision)
The platform already has a generic operational log table (`event_logs`, migration 1068) with `source`/`severity`/`status`/`error_message` columns, and an existing admin viewer at `/admin/logs` (`getPlatformLogs()` in `src/app/(admin)/admin/logs/_actions/get-platform-logs.ts`) that already filters by source, severity, status, tenant, period, and free-text search. This phase does NOT build a new billing-specific admin panel — it wires the two billing failure points to write rows into the existing `event_logs` table, tagged with a distinguishing `source` value. BOB-03 ("admin can see recent billing failures without a manual DB query") is satisfied by the existing `/admin/logs` page once these writes land — filtering by `source = 'stripe-webhook'` (or the chosen source tag for webhook errors) or `source = 'billing-credits'` (or chosen tag for debit failures) surfaces them with zero new UI.

This was an explicit user choice (reuse vs. build dedicated panel) — reuse was chosen to avoid duplicating an already-solved generic problem.

### Claude's Discretion
- Exact `source` tag values for the two failure points (e.g. `'stripe-webhook'` and `'billing-credits'` vs alternatives) — pick clear, distinguishing values consistent with existing `source` conventions already in the table (`action-engine`, `vapi-webhook`, `meta-webhook`, `cron`)
- Exact `event_type` values, `severity`/`status` mapping, and what goes in `payload` vs `error_message`/`error_stack`
- Whether webhook failure logging happens for ALL processing exceptions or only specific ones — should cover any exception during event processing (BOB-01's wording: "errors during processing")
- Whether the credit-debit failure log write happens inside `meterDebit`'s existing catch block or via a wrapper

</decisions>

<code_context>
## Existing Code Insights

- `supabase/migrations/1068_event_logs.sql` — `event_logs` table: `org_id` (nullable for platform-level), `event_type`, `source`, `severity` ('debug'|'info'|'warn'|'error'|'fatal'), `status` ('ok'|'failed'|'retried'|'skipped'), `correlation_id`, `actor_type`, `actor_id`, `payload` jsonb, `error_message`, `error_stack`, `duration_ms`, `created_at`. Insert is service-role only (bypasses RLS).
- `src/app/(admin)/admin/logs/_actions/get-platform-logs.ts` — `getPlatformLogs()` already supports filtering by `source`, `severity`, `status`, `tenant`, `period`, free-text search across `event_type`/`source`/`error_message`/`actor_id`. No changes needed here for basic reuse; existing `sources` dropdown will auto-pick-up any new distinct `source` value once rows exist.
- `src/app/(admin)/admin/logs/page.tsx` — the existing admin logs page UI, already renders whatever `getPlatformLogs()` returns.
- `src/app/api/stripe/webhook/route.ts` — the webhook handler (BOB-01 target); has a catch/error path around event processing per Phase 116's test coverage (`tests/billing-webhook.test.ts` already tests the "processing-failure path (500, processed_at intentionally left unset)").
- `src/lib/billing/credits.ts` `meterDebit()` — the generic debit interface (Phase 114); currently catches errors and fails open silently (`console.error('[billing] meterDebit failed (failing open):', err)`) — this is the BOB-02 target, needs to ALSO write an `event_logs` row, not just console.error.
- `src/lib/supabase/admin.ts` `createServiceRoleClient()` — the client to use for the `event_logs` insert (service-role required per RLS).

</code_context>

<specifics>
## Specific Ideas

No additional specific requests — the reuse decision above covers the full BOB-01..03 surface.

</specifics>

<deferred>
## Deferred Ideas

A dedicated billing-specific admin panel (with billing-specific summary cards, etc.) was considered and explicitly deferred in favor of reusing the generic `/admin/logs` viewer.

</deferred>

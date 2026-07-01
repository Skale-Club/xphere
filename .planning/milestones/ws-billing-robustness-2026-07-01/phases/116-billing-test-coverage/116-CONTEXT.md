# Phase 116: Billing Test Coverage - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

The billing surface (checkout, webhooks, entitlements, credit RPCs) has an automated regression safety net so future changes — including this milestone's own metering refactor (Phase 114) — can be verified without manual Stripe testing.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure test-authoring phase (BTC-01..04), no user-facing behavior is defined here. Use the ROADMAP phase goal, success criteria, and existing test conventions (Vitest, `tests/` directory, mock patterns already used in `tests/billing-entitlements-unit.test.ts` and `tests/scheduling-bookings.test.ts`) to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Known from prior phases this session:
- `src/lib/billing/credits.ts` — `meterDebit()` (Phase 114), `getCopilotBalance()`, `resolveCreditsVisibility()` (Phase 115)
- `src/lib/billing/credits-visibility.ts` — `hasCreditsPlan()`, `getCreditsVisualState()` (Phase 115)
- `src/lib/billing/entitlements.ts` — `resolveEffectivePlan()`, `getEntitlements()`
- `src/app/api/stripe/webhook/route.ts` — Stripe webhook handler
- `src/lib/billing/actions.ts` — `createCheckoutSession()`, `createCreditTopUpSession()`
- `supabase/migrations/1225_metering_reason.sql` — 4-arg `debit_copilot_credits` RPC (post-Phase-114 shape, this is what BTC-03 must test against)
- No component-render test infrastructure exists (`vitest.config.ts` environment: 'node') — this phase is entirely backend/logic testing, unaffected by that gap

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria (BTC-01..04).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

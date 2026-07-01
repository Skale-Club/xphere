# Phase 114: Metering Architecture - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Platform has a single reusable credit-debit interface, tagged by feature/reason, that any future feature (workflows, campaigns, calls) can plug into later without redesign — with Copilot migrated onto it today with zero behavior change.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure infrastructure/refactor phase (single exported interface, ledger tagging, Copilot call-site refactor, doc comment). No user-facing behavior is defined here; use the ROADMAP phase goal, success criteria, and existing `src/lib/billing/credits.ts` conventions to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Known from prior assessment this session:
- `src/lib/billing/credits.ts` — `debitCopilot()`, `grantCopilot()`, `getCopilotBalance()`, `hasCopilotCredits()`, `resetCopilotForPeriod()`
- `src/app/(dashboard)/copilot/_actions/turn.ts:59` — pre-check + post-turn debit call site
- Migration `1208_copilot_credits.sql` — `copilot_credits` (dual-bucket) + `copilot_credit_ledger` (append-only) + SECURITY DEFINER RPCs (`debit_copilot_credits`, `credit_copilot_credits`, `reset_copilot_credits`)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria (MET-01..04).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Wiring workflows/campaigns/calls to actually debit through this interface is explicitly deferred to a future milestone (see REQUIREMENTS.md v2 MET-05..08).

</deferred>

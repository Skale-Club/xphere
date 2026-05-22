# Phase 105: Engine Unification - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Delegate flow engine action execution to the shared Action Engine's `executeAction()`, eliminating the separate executor path in `lib/flows/executors.ts`.

</domain>

<decisions>
## Implementation Decisions

### the agent's Discretion
All implementation choices are at the agent's discretion — pure infrastructure/refactoring phase. Refer to ROADMAP success criteria and codebase conventions.

</decisions>

<code_context>
## Existing Code Insights

### Key Files
- `src/lib/flows/engine.ts` — current flow engine with inline dispatch to executors.ts
- `src/lib/flows/executors.ts` — contains stubs for most action types (`executeStub` for send_sms, create_contact, pipeline_*)
- `src/lib/action-engine/execute-action.ts` — canonical Action Engine with real executors for 20+ types

### Established Patterns
- Action Engine uses `executeAction(actionType, payload, orgId)` signature
- Flow engine uses its own node-walking dispatch to executors
- Both engines operate within the same process (no edge/worker boundary)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Follow ROADMAP goal and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None
</deferred>

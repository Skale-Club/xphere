---
id: SEED-047
status: dormant
planted: 2026-05-21
planted_during: post-v2.9 UX Polish — comprehensive workflow audit
trigger_when: next milestone that touches the workflow engine, event dispatch, or action executor layer; or when a user reports "workflow ran but nothing happened"
scope: Large
depends_on: []
---

# SEED-047: Workflow Runtime Hardening — Event Dispatch, Engine Unification, Executor Completeness

## Why This Matters

A comprehensive audit (2026-05-21) revealed that the workflow runtime has several critical gaps that make it **non-functional for real use** beyond manual "Run now" clicks and agent-callable tools. The flows builder UI is mature and polished, but the execution layer behind it has never been fully wired end-to-end.

### The Gaps

**1. Event dispatch never executes workflows.** `lib/scheduling/transition.ts:emitCalendarEvent()` finds matching workflows, records an `event_dispatches` audit row, then **stops**. The code explicitly says "deferred to a queue worker" — but no worker ever picks it up. Workflows with trigger `event:meeting.*` have never run.

**2. Two parallel engines that do not share logic.**
- `lib/flows/engine.ts` (used by manual "Run now") has its own `executors.ts` with a subset of action implementations. Most actions (`send_sms`, `create_contact`, `pipeline_*`, etc.) fall through to `executeStub` which returns `{ _stub: true, _note: 'Executor not yet wired' }`.
- `lib/workflows/run-flow-sync.ts` (used by agent-callable flows) calls the Action Engine's `executeAction()` directly — but has its own graph normalization, scope tracking, and run recording logic.
- Neither shares code with `lib/workflows/run.ts` (the legacy tool-kind wrapper).

**3. Platform-default seeds are orphans.** 10 YAML workflow seeds in `supabase/seeds/workflows/` use the YAML spec format (`trigger`/`nodes`/`edges`). The flow engine only accepts `FlowDefinition` format (`version: 1`/`nodes`/`edges`). No loader converts between them. Seeds are never loaded into the database.

**4. Duplicate server actions.** `workflows/flows/_actions/` and `automations/flows/_actions/` are near-identical copies. Components import from both locations.

**5. Zero test coverage.** No tests exist for the flow engine, executors, schema validation, workflow validator, or any flow builder component.

**6. Dead code.** `feature-flag.ts` (always returns true), `derive-action-type.ts` (unused by new paths), legacy `tool_configs` fallbacks in server actions, `workflow_triggers` table (created in migration 075, never read or written).

## What Needs to Change

### Phase A — Wire Event Dispatch to Execution

**Goal:** Event-triggered workflows actually run when the event fires.

In `lib/scheduling/transition.ts`, after `emitCalendarEvent()` records the dispatch row, call `runFlow()` for each matched workflow using a service-role client. The trigger payload should include the full booking snapshot so the workflow has `{{meeting.*}}` variables in scope.

Key considerations:
- Use `createServiceRoleClient()` — events fire outside user auth context
- Cascade depth protection already exists (MAX_CASCADE_DEPTH = 3)
- Run should be fire-and-forget (not block the booking transition)
- Error handling: a failed workflow run should not roll back the booking transition
- `lib/pipeline/events.ts` has the same gap for opportunity events — wire it too

### Phase B — Unify the Two Engines

**Goal:** One canonical execution path for all workflows regardless of trigger type.

Option A (recommended): Make `lib/flows/engine.ts` delegate action execution to `executeAction()` from the Action Engine instead of maintaining `executors.ts`. This gives the flow engine immediate access to all 20+ action types that the Action Engine already supports (`send_sms`, `create_contact`, `pipeline_*`, etc.).

Option B: Make the `executors.ts` import and wrap the Action Engine executors directly. Less refactoring but keeps the indirection layer.

Either way: delete `executors.ts` once all action types are covered. Keep only flow-specific executors (`booking_*`, condition evaluation, wait recording) there or move them inline into `engine.ts`.

### Phase C — Convert Seeds and Load at Deploy

**Goal:** Platform-default workflows actually exist in the database.

Create a seed loader script that:
1. Reads YAML files from `supabase/seeds/workflows/`
2. Converts each from YAML spec format to `FlowDefinition` format (approximate positions via dagre auto-layout)
3. Upserts into `workflows` + `workflow_versions` for every org
4. Runs as part of deploy (next start / seed script)

The conversion is straightforward: YAML `nodes[{id, kind, config}]` → flow `nodes[{id, type: kind, position: auto, data: {kind, ...config}}]`. The trigger block maps to a trigger node.

### Phase D — Clean Up Duplication and Dead Code

**Goal:** One source of truth for every function.

- Delete `automations/flows/_actions/` and update all imports in components to point to `workflows/flows/_actions/`
- Delete `feature-flag.ts` and all callers
- Delete `derive-action-type.ts` if unused
- Remove `tool_configs` fallback code from `toggleWorkflowActive()` and similar server actions
- Drop or archive `workflow_triggers` table (migration not needed, just stop writing to it)

### Phase E — Add Test Coverage

**Goal:** Prevent regressions and document expected behavior.

At minimum:
- `lib/flows/engine.ts` — unit test with mocked Supabase: verify linear execution, condition branching, wait recording, end-node termination, error propagation
- `lib/flows/executors.ts` — test http_request executor, booking_* executors
- `lib/flows/schema.ts` — test `validateFlow()`: missing trigger, disconnected nodes, orphan edges
- `lib/workflows/validate.ts` — test validation rules: unknown trigger, missing input_schema, cycle detection, unreachable nodes, variable scoping
- `lib/workflows/run-flow-sync.ts` — test graph normalization (both shapes), interpolation, scope promotion
- `lib/scheduling/transition.ts` — test that `emitCalendarEvent` actually calls `runFlow` after wiring

### Phase F (Optional) — Register Missing Executors in Action Engine

Verify and add any remaining action types to `execute-action.ts` that exist in the spec but not in the runtime:
- `send_email` — not implemented anywhere
- `knowledge_base` — not implemented as action
- `custom_webhook` — exists in spec, check runtime parity

## When to Surface

**Trigger:** Next milestone that touches the workflow engine, event dispatch, or action executor layer; or when a user reports "workflow ran but nothing happened."

This seed should be presented during `/gsd-new-milestone` when:
- Milestone scope includes "workflow engine", "event dispatch", "action executor", "workflow runtime", or "flow execution"
- Milestone scope includes "infrastructure hardening", "tech debt cleanup", or "stability"
- Milestone is a continuation of v2.9 (Workflows Unification) or v3.0 planning

**Strong recommendation:** This should be the **first milestone after v2.9** before any new workflow feature work begins. Building on top of a broken runtime accrues compounding tech debt.

## Scope Estimate

**Large** — 6 phases, estimated 3-4 weeks of focused work:
- Phase A (Event dispatch): ~3 days
- Phase B (Engine unification): ~5 days
- Phase C (Seed loading): ~2 days
- Phase D (Cleanup): ~3 days
- Phase E (Tests): ~4 days
- Phase F (Missing executors): ~2 days

## Breadcrumbs

### Event dispatch gap
- `src/lib/scheduling/transition.ts:102-103` — "deferred to a queue worker" comment, runFlow() never called
- `src/app/api/cron/scheduling-tick/route.ts` — tick scheduler emits events but does not await runFlow
- `src/lib/pipeline/events.ts` — `emitOpportunityEvent()` has the same gap
- `supabase/migrations/086_event_dispatches.sql` — audit table exists, consumer does not
- `supabase/migrations/087_scheduled_workflow_ticks.sql` — idempotency table for calendar ticks
- `supabase/migrations/099_pipeline_workflow_automation.sql` — `scheduled_opportunity_ticks` for pipeline

### Two engines
- `src/lib/flows/engine.ts` — flow engine (runFlow), manual runs
- `src/lib/flows/executors.ts` — stubs for most actions (send_sms, create_contact, pipeline_*, etc.)
- `src/lib/workflows/run-flow-sync.ts` — agent-callable flow executor, calls executeAction directly
- `src/lib/workflows/run.ts` — legacy tool-kind wrapper
- `src/lib/action-engine/execute-action.ts` — canonical Action Engine with real executors

### Seed loading gap
- `supabase/seeds/workflows/` — 10 YAML files in spec format
- `src/lib/flows/schema.ts` — FlowDefinition format expected by engine
- `src/lib/workflows/validate.ts` — validates YAML spec format
- `src/lib/workflows/spec.ts` — trigger/node catalog

### Duplicate actions
- `src/app/(dashboard)/workflows/flows/_actions/workflows.ts`
- `src/app/(dashboard)/automations/flows/_actions/workflows.ts`
- `src/components/flows/flow-toolbar.tsx:16` — imports from automations path
- `src/components/flows/flow-canvas.tsx:27` — imports from workflows path
- `src/components/flows/new-flow-form.tsx:11` — imports from workflows path

### Dead code
- `src/lib/workflows/feature-flag.ts` — deprecated, always returns true
- `src/lib/workflows/derive-action-type.ts` — only used in legacy paths
- `src/lib/workflows/derive-input-schema.ts` — SEED-033, check if still needed
- `supabase/migrations/075_workflow_engine.sql` — `workflow_triggers` table, never read/written

### Missing executor stubs
- `src/lib/flows/executors.ts:332-347` — `executeStub()` default fallback
- `src/lib/flows/executors.ts:416` — `default: return executeStub(...)`
- `src/lib/action-engine/execute-action.ts` — reference for real executors

### No tests
- No test files in `src/lib/flows/`
- No test files in `src/lib/workflows/`
- No tests for any flow builder component
- `tests/action-engine.test.ts` — only existing action-engine test (for legacy path)

## Notes

This seed was produced from a comprehensive codebase audit on 2026-05-21 covering:
- All 7 migration files related to workflows (074, 075, 080, 086, 087, 095, 099, 100)
- All 10 lib/workflows/ files
- All 11 lib/flows/ files
- All 13 flow builder component files
- The flow store, schema, AI builder tools
- The scheduling transition module, pipeline events, cron tick scheduler
- All 10 platform-default YAML seeds
- Action engine and all its executors

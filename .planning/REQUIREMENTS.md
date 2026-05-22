# v3.0 Workflow Runtime Hardening — Requirements

## Event Dispatch

- [ ] **EVNT-01**: Calendar events in `emitCalendarEvent()` call `runFlow()` for each matched workflow instead of only recording a dispatch row
- [ ] **EVNT-02**: Pipeline events in `emitOpportunityEvent()` call `runFlow()` for each matched workflow
- [ ] **EVNT-03**: Event-triggered workflows use service-role client, fire-and-forget, with cascade depth protection (existing MAX_CASCADE_DEPTH=3)
- [ ] **EVNT-04**: Failed workflow run does not roll back the originating booking/opportunity transition

## Engine Unification

- [ ] **ENG-01**: `lib/flows/engine.ts` delegates action execution to `executeAction()` from the Action Engine instead of maintaining `executors.ts`
- [ ] **ENG-02**: All 20+ action types (`send_sms`, `create_contact`, `pipeline_*`, etc.) work from the flow engine via delegation
- [ ] **ENG-03**: `executors.ts` is deleted once all action types are covered (flow-specific executors like `booking_*` move inline or stay in engine.ts)

## Seed Loading

- [ ] **SEED-01**: Seed loader script reads YAML files from `supabase/seeds/workflows/`
- [ ] **SEED-02**: Seed loader converts from YAML spec format to `FlowDefinition` format with auto-layout positions
- [ ] **SEED-03**: Seed loader upserts into `workflows` + `workflow_versions` for every org
- [ ] **SEED-04**: Seed loading runs as part of deploy (`npm run seed` or next start hook)

## Cleanup

- [ ] **CLN-01**: Delete `automations/flows/_actions/` and update all component imports to point to `workflows/flows/_actions/`
- [ ] **CLN-02**: Delete `feature-flag.ts` and all callers
- [ ] **CLN-03**: Delete `derive-action-type.ts` if unused
- [ ] **CLN-04**: Remove `tool_configs` fallback code from `toggleWorkflowActive()` and similar server actions
- [ ] **CLN-05**: Drop or archive `workflow_triggers` table (stop writing to it)

## Testing

- [ ] **TEST-01**: `lib/flows/engine.ts` — unit test with mocked Supabase: linear execution, condition branching, wait recording, end-node termination, error propagation
- [ ] **TEST-02**: `lib/flows/executors.ts` — test `http_request` executor, `booking_*` executors (before deletion)
- [ ] **TEST-03**: `lib/flows/schema.ts` — test `validateFlow()`: missing trigger, disconnected nodes, orphan edges
- [ ] **TEST-04**: `lib/workflows/validate.ts` — test validation rules: unknown trigger, missing input_schema, cycle detection, unreachable nodes, variable scoping
- [ ] **TEST-05**: `lib/workflows/run-flow-sync.ts` — test graph normalization (both shapes), interpolation, scope promotion
- [ ] **TEST-06**: `lib/scheduling/transition.ts` — test that `emitCalendarEvent` actually calls `runFlow` after wiring

## Executor Completeness

- [ ] **EXEC-01**: `send_email` executor implemented and registered in `execute-action.ts`
- [ ] **EXEC-02**: `knowledge_base` action type implemented and registered
- [ ] **EXEC-03**: `custom_webhook` runtime parity verified against spec

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVNT-01 | Phase 107 (Event Dispatch) | Pending |
| EVNT-02 | Phase 107 (Event Dispatch) | Pending |
| EVNT-03 | Phase 107 (Event Dispatch) | Pending |
| EVNT-04 | Phase 107 (Event Dispatch) | Pending |
| ENG-01 | Phase 105 (Engine Unification) | Pending |
| ENG-02 | Phase 105 (Engine Unification) | Pending |
| ENG-03 | Phase 105 (Engine Unification) | Pending |
| SEED-01 | Phase 108 (Seed Loading) | Pending |
| SEED-02 | Phase 108 (Seed Loading) | Pending |
| SEED-03 | Phase 108 (Seed Loading) | Pending |
| SEED-04 | Phase 108 (Seed Loading) | Pending |
| CLN-01 | Phase 110 (Cleanup) | Pending |
| CLN-02 | Phase 110 (Cleanup) | Pending |
| CLN-03 | Phase 110 (Cleanup) | Pending |
| CLN-04 | Phase 110 (Cleanup) | Pending |
| CLN-05 | Phase 110 (Cleanup) | Pending |
| TEST-01 | Phase 109 (Testing) | Pending |
| TEST-02 | Phase 109 (Testing) | Pending |
| TEST-03 | Phase 109 (Testing) | Pending |
| TEST-04 | Phase 109 (Testing) | Pending |
| TEST-05 | Phase 109 (Testing) | Pending |
| TEST-06 | Phase 109 (Testing) | Pending |
| EXEC-01 | Phase 106 (Executor Completeness) | Pending |
| EXEC-02 | Phase 106 (Executor Completeness) | Pending |
| EXEC-03 | Phase 106 (Executor Completeness) | Pending |

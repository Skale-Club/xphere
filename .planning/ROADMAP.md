# Roadmap: Operator

## Milestones

- v1.0 MVP — Phases 1-6 (shipped 2026-04-03)
- v1.1 Knowledge Base — Phase 7 (shipped 2026-04-03)
- v1.2 Operator + Embedded Chatbot — Phases 8-13 (shipped 2026-04-05)
- v1.3 Google Reviews + Meta Messaging — Phases 14-20 (shipped 2026-05-05)
- v1.4 Chat System Refactor — Phases 21-25 (shipped 2026-05-05)
- v1.5 Tools Folder System — Phases 26-28 (shipped 2026-05-06)
- v1.6 ManyChat Integration — Phases 29-31 (shipped 2026-05-07)
- v1.7 Google Contacts — Phases 32-37 (shipped 2026-05-07)
- v1.8 Executor Completeness — Phases 38-46 (shipped 2026-05-08)
- v1.9 GHL Reengagement — Phases 47-53 (shipped 2026-05-16)
- v2.0 Multi-Bot Platform — Phases 54-63 (shipped 2026-05-17)
- v2.1 CRM + Omnichannel + Redesign — Phases 64-74 (shipped 2026-05-17)
- v2.3 Integrations Refactor — Phases 75-80 (human_uat)
- v2.4 CRM Expansion — Phases 81-92 (shipped 2026-05-19)
- v2.5 Tasks & Notes — Phases 93-98 (shipped 2026-05-19)
- v2.6 Admin Landing SEO — Phases 99-101 (shipped 2026-05-19)
- v2.7 Unified Calls Hub + Pipeline UX — Phases 102-104 (shipped 2026-05-19)
- <details>
  <summary>Earlier milestones (v1.0–v2.0)</summary>

  - v1.0 MVP — Phases 1-6 (shipped 2026-04-03)
  - v1.1 Knowledge Base — Phase 7 (shipped 2026-04-03)
  - v1.2 Operator + Embedded Chatbot — Phases 8-13 (shipped 2026-04-05)
  - v1.3 Google Reviews + Meta Messaging — Phases 14-20 (shipped 2026-05-05)
  - v1.4 Chat System Refactor — Phases 21-25 (shipped 2026-05-05)
  - v1.5 Tools Folder System — Phases 26-28 (shipped 2026-05-06)
  - v1.6 ManyChat Integration — Phases 29-31 (shipped 2026-05-07)
  - v1.7 Google Contacts — Phases 32-37 (shipped 2026-05-07)
  - v1.8 Executor Completeness — Phases 38-46 (shipped 2026-05-08)
  - v1.9 GHL Reengagement — Phases 47-53 (shipped 2026-05-16)
  - v2.0 Multi-Bot Platform — Phases 54-63 (shipped 2026-05-17)
  - v2.1 CRM + Omnichannel + Redesign — Phases 64-74 (shipped 2026-05-17)
  - v2.3 Integrations Refactor — Phases 75-80 (human_uat)
  - v2.4 CRM Expansion — Phases 81-92 (shipped 2026-05-19)
  - v2.5 Tasks & Notes — Phases 93-98 (shipped 2026-05-19)
  - v2.6 Admin Landing SEO — Phases 99-101 (shipped 2026-05-19)
  - v2.7 Unified Calls Hub + Pipeline UX — Phases 102-104 (shipped 2026-05-19)
</details>
- **v3.0 Workflow Runtime Hardening — Phases 105-110 (in progress)**

## Overview

v3.0 makes the workflow runtime actually work. Events trigger execution through a unified engine, actions run beyond stubs, seeds load at deploy, and the engine is testable. This milestone hardens the foundation — wiring calendar and pipeline events to `runFlow()`, unifying the flow engine with the Action Engine, converting YAML seeds, registering missing executors, adding test coverage, and cleaning up dead code.

## Phases

- [ ] **Phase 105: Engine Unification** — Delegate flow engine action execution to the shared Action Engine
- [ ] **Phase 106: Executor Completeness** — Register missing executor types (send_email, knowledge_base, custom_webhook)
- [ ] **Phase 107: Event Dispatch** — Wire calendar and pipeline events to trigger workflow execution
- [ ] **Phase 108: Seed Loading** — Convert YAML seeds and load platform-default workflows at deploy
- [ ] **Phase 109: Testing** — Add unit test coverage for engine, executors, schema, validators, and event wiring
- [ ] **Phase 110: Cleanup** — Remove duplicate directories, dead code, and deprecated artifacts

## Phase Details

### Phase 105: Engine Unification
**Goal**: Flow engine delegates all action execution to the shared Action Engine's `executeAction()`, eliminating the separate executor path
**Depends on**: Nothing (milestone foundation)
**Requirements**: ENG-01, ENG-02, ENG-03
**Success Criteria** (what must be TRUE):
  1. All 20+ action types (`send_sms`, `create_contact`, `pipeline_*`, `booking_*`, etc.) execute successfully when triggered from a workflow flow via the unified path
  2. `lib/flows/engine.ts` delegates to `executeAction()` — no action-specific switch/if-else in the flow engine
  3. `lib/flows/executors.ts` file deleted once all action types it covered are verified working through `executeAction()`
  4. Flow-specific executors (`booking_*`) either moved inline in `engine.ts` or kept with clear documentation — no dead code left behind
  5. Existing action engine test suite still passes after delegation refactor
**Plans**: 1 plan

Plans:
- [ ] 105-01-PLAN.md — Refactor engine.ts: inline flow-internal executors, delegate shared actions to executeAction(), delete executors.ts

### Phase 106: Executor Completeness
**Goal**: Missing executor types implemented and registered so all declared action types work at runtime
**Depends on**: Phase 105
**Requirements**: EXEC-01, EXEC-02, EXEC-03
**Success Criteria** (what must be TRUE):
  1. `send_email` action type sends email via the configured provider (Resend or SMTP) with correct recipient, subject, and body
  2. `knowledge_base` action type queries the org's knowledge base and returns relevant document chunks
  3. `custom_webhook` executor matches the spec — configurable URL/method/headers/body with `{{param}}` substitution, 10s timeout, truncated response
  4. All three executor types are registered in `execute-action.ts` dispatch and appear as selectable action types in the tool config form
  5. Execution logs (`action_logs`) capture each new executor invocation with proper input, output, status, and timing
**Plans**: TBD

### Phase 107: Event Dispatch
**Goal**: Calendar and pipeline events trigger workflow execution through the unified engine with proper isolation and safety guards
**Depends on**: Phase 105
**Requirements**: EVNT-01, EVNT-02, EVNT-03, EVNT-04
**Success Criteria** (what must be TRUE):
  1. Creating/updating a booking via the scheduling system triggers matched workflows to run (e.g., confirmation email sent automatically)
  2. Moving an opportunity through pipeline stages triggers matched workflows (e.g., Slack notification or internal webhook on stage change)
  3. A failing workflow run does not block or roll back the originating booking creation or opportunity transition — the source operation always completes
  4. Recursive or cyclic workflow chains are safely terminated at MAX_CASCADE_DEPTH=3 — no infinite execution loops
  5. Event-triggered workflows use service-role client and fire-and-forget semantics — no user auth dependency at runtime
**Plans**: TBD

### Phase 108: Seed Loading
**Goal**: Platform-default YAML workflow seeds are converted, loaded into every org, and applied as part of deploy
**Depends on**: Phase 107
**Requirements**: SEED-01, SEED-02, SEED-03, SEED-04
**Success Criteria** (what must be TRUE):
  1. Running `npm run seed` reads all YAML files from `supabase/seeds/workflows/` and loads them into the database
  2. Each seeded workflow has auto-generated layout positions so nodes appear organized on the canvas without manual arrangement
  3. Seeded workflows are upserted into `workflows` + `workflow_versions` for every existing org (idempotent — no duplicates on re-run)
  4. Newly created orgs automatically receive the seeded platform-default workflows
  5. Seed loading is wired into deploy (next start hook or post-deploy step) so fresh deployments always have seeds
**Plans**: TBD

### Phase 109: Testing
**Goal**: Core engine, executor, schema validation, and event-wiring logic have automated test coverage before cleanup deletes old code
**Depends on**: Phase 105, Phase 106, Phase 107
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06
**Success Criteria** (what must be TRUE):
  1. `engine.ts` unit tests pass with mocked Supabase: linear execution, condition branching, wait recording, end-node termination, and error propagation
  2. `executors.ts` unit tests pass for `http_request` and `booking_*` executors (run before Phase 110 cleanup removes the file)
  3. `validateFlow()` in `schema.ts` correctly rejects flows with missing triggers, disconnected nodes, and orphan edges
  4. `validate.ts` validation rules correctly detect unknown triggers, missing `input_schema`, cycle detection, unreachable nodes, and variable scoping errors
  5. `run-flow-sync.ts` tests pass for graph normalization (both input shapes), interpolation, and scope promotion
  6. `transition.ts` test verifies that `emitCalendarEvent()` calls `runFlow()` for matched workflows after event dispatch wiring
**Plans**: TBD

### Phase 110: Cleanup
**Goal**: Duplicate directories, dead code, and deprecated artifacts removed after verifying the unified engine works
**Depends on**: Phase 105, Phase 109
**Requirements**: CLN-01, CLN-02, CLN-03, CLN-04, CLN-05
**Success Criteria** (what must be TRUE):
  1. `automations/flows/_actions/` directory deleted and all component imports updated to `workflows/flows/_actions/` — no broken imports across the codebase
  2. `feature-flag.ts` removed — no modules import or reference it
  3. `derive-action-type.ts` removed — no modules import or reference it
  4. `toggleWorkflowActive()` and similar server actions have no remaining `tool_configs` fallback code (clean, single-path logic)
  5. `workflow_triggers` table archived or dropped — no code path writes to it
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 105 → 106 → 107 → 108 → 109 → 110

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 105. Engine Unification | 0/1 | Not started | - |
| 106. Executor Completeness | 0/TBD | Not started | - |
| 107. Event Dispatch | 0/TBD | Not started | - |
| 108. Seed Loading | 0/TBD | Not started | - |
| 109. Testing | 0/TBD | Not started | - |
| 110. Cleanup | 0/TBD | Not started | - |

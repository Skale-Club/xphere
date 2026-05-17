---
phase: 23-inbound-routing
plan: "02"
subsystem: manychat-dispatcher
tags:
  - manychat
  - action-engine
  - routing
  - dispatcher
dependency_graph:
  requires:
    - "23-01: manychat_rules DDL + database.ts widening + RED test stubs"
  provides:
    - "resolveRule: first-match-wins rule matcher"
    - "resolveToolById: UUID-keyed tool resolver"
    - "dispatchManychatEvent: full event orchestration"
    - "logAction: widened to return Promise<string | null>"
  affects:
    - "23-04: webhook handler calls dispatchManychatEvent inline"
    - "23-03: rule-actions server actions (no file overlap)"
tech_stack:
  added: []
  patterns:
    - "JS condition containment matching over SQL @> for testability and first-match-wins short-circuit"
    - "Synthetic vapi_call_id='manychat:{eventId}' to satisfy NOT NULL without schema rename"
    - "Service-role supabase client passed through to dispatchManychatEvent for UPDATE permissions"
key_files:
  created:
    - src/lib/action-engine/resolve-tool-by-id.ts
    - src/lib/manychat/resolve-rule.ts
    - src/lib/manychat/dispatch-event.ts
  modified:
    - src/lib/action-engine/log-action.ts
decisions:
  - "JS containment matching chosen over SQL @> operator: per-org rule sets are small (5-50), single round-trip is fine, first-match-wins short-circuits cleanly, easier to unit test with mocked arrays"
  - "logAction widened to Promise<string | null> instead of Promise<void>: backward-compatible because Vapi caller uses await inside after() and discards return value"
  - "dispatchManychatEvent writes its own action_logs.insert directly rather than calling logAction(): needs the inserted ID synchronously to populate manychat_events.action_log_id"
  - "markEvent() helper scoped to dispatch-event.ts: encapsulates the service-role-only UPDATE path with clean error swallowing"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-06T20:31:41Z"
  tasks_completed: 3
  files_created: 3
  files_modified: 1
---

# Phase 23 Plan 02: Dispatcher Modules Summary

**One-liner:** ManyChat event dispatcher with JS condition-containment rule matching, UUID-keyed tool resolution, and atomic action_log_id back-linking via synthetic `manychat:{eventId}` vapi_call_id.

## What Was Built

Three new modules and one modified module forming the engine half of Phase 23 inbound routing:

1. **`src/lib/action-engine/resolve-tool-by-id.ts`** — Sibling of `resolveTool`, keyed by `tool_config.id` UUID (the FK from `manychat_rules.tool_config_id`). Re-uses `ToolConfigWithIntegration` type from `resolve-tool.ts` without redefining it. Returns null when tool is inactive or `encrypted_api_key` is missing.

2. **`src/lib/action-engine/log-action.ts`** (modified) — Return type widened from `Promise<void>` to `Promise<string | null>`. Uses `.insert().select('id').single()` to return the inserted `action_logs.id`. Backward-compatible: Vapi caller ignores the return value inside `after()`.

3. **`src/lib/manychat/resolve-rule.ts`** — Queries `manychat_rules` by `(org_id, channel_id, event_type, is_active=true) ORDER BY priority ASC`, then iterates in JS for JSONB condition containment matching. First-match-wins with recursive support for nested objects.

4. **`src/lib/manychat/dispatch-event.ts`** — Full orchestrator: `resolveRule → resolveToolById → decrypt → executeAction → action_logs.insert → manychat_events.update`. Never throws. All failure modes (no rule, no tool, executeAction throws) write deterministic status to `manychat_events`. Uses `manychat:{eventId}` as synthetic `vapi_call_id`.

## Test Results

All 13 RED stubs from Plan 23-01 are now GREEN:

- `tests/manychat/resolve-rule.test.ts`: 7/7 PASS (ROUTING-03)
- `tests/manychat/dispatch-event.test.ts`: 6/6 PASS (ROUTING-03 + ROUTING-04)

No regressions in existing test suite (`tests/action-engine.test.ts`, `tests/chat-api.test.ts`, etc.). Pre-existing RED stubs in `tests/manychat/rule-actions.test.ts` remain RED (Plan 23-03's responsibility).

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 | `9341fce` | feat(23-02): implement resolveToolById and widen logAction to Promise<string \| null> |
| Task 2 | `d9d310b` | feat(23-02): implement resolveRule with JS condition containment (first-match-wins) |
| Task 3 | `1607cfb` | feat(23-02): implement dispatchManychatEvent orchestrator (ROUTING-04) |

## Deviations from Plan

None — plan executed exactly as written. All implementation code was copied precisely from the plan's `<action>` blocks.

## Known Stubs

None. All modules are fully wired. The webhook caller (`/api/manychat/webhook`) is the remaining connection point — handled in Plan 23-04.

## Self-Check: PASSED

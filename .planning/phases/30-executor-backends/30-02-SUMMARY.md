---
phase: 30
plan: "02"
name: custom-webhook-executor
subsystem: action-engine
tags: [executor, custom_webhook, action-engine, http, vapi]
dependency_graph:
  requires: []
  provides: [custom_webhook-executor]
  affects: [execute-action, vapi-tools-route, manychat-dispatch-event]
tech_stack:
  added: []
  patterns: [executor-module-pattern, placeholder-substitution, abort-controller-timeout]
key_files:
  created:
    - src/lib/custom-webhook/execute-webhook.ts
  modified:
    - src/lib/action-engine/execute-action.ts
    - src/app/api/vapi/tools/route.ts
    - src/lib/manychat/dispatch-event.ts
decisions:
  - "toolConfig passed via ActionContext optional field rather than through params to keep executor signature clean"
  - "Non-2xx responses return error string (not throw) — action engine error catch path handles timeouts vs logical errors consistently"
  - "send_sms stub preserved with comment referencing parallel plan 30-01"
metrics:
  duration_seconds: 134
  completed_date: "2026-05-08"
  tasks_completed: 4
  files_created: 1
  files_modified: 3
---

# Phase 30 Plan 02: Custom Webhook Executor Summary

## One-liner

HTTP executor for `custom_webhook` action type — configurable URL/method/headers/body with `{{param}}` template substitution, 10s AbortController timeout, and no-newline result strings for Vapi compatibility.

## What Was Built

### `src/lib/custom-webhook/execute-webhook.ts`

New executor module with:
- `parseConfig(raw: Json): WebhookConfig` — validates config shape, defaults method to `'POST'`
- `replacePlaceholders(template, params)` — replaces `{{param_name}}` with `String(params[key] ?? '')`
- `sanitize(text)` — strips newlines (Vapi constraint)
- `truncate(text, 500)` — caps response body at 500 chars for action_logs readability
- `executeWebhook(params, rawConfig)` — fires the HTTP request with AbortController (10s), returns single-line result string

Result patterns:
- Success: `'Webhook OK status=200 body=...'`
- Non-2xx: `'Webhook error status=422 body=...'`
- Timeout: AbortError propagates to caller (executor does not swallow it)

### `src/lib/action-engine/execute-action.ts`

- Added `toolConfig?: Json` to `ActionContext` interface
- Imported `executeWebhook` from `@/lib/custom-webhook/execute-webhook`
- `case 'custom_webhook'` now dispatches to `executeWebhook(params, ctx.toolConfig)` instead of throwing
- `send_sms` case preserved as explicit stub with comment referencing plan 30-01

### Call sites updated

- `src/app/api/vapi/tools/route.ts` — passes `toolConfig: toolConfig.config` in ctx
- `src/lib/manychat/dispatch-event.ts` — passes `toolConfig: tool.config` in ctx

## Decisions Made

1. **toolConfig via ActionContext** — The executor needs `tool_configs.config` JSONB. Rather than threading it through `params` (which would pollute the semantic params space), an optional `toolConfig` field was added to `ActionContext`. Both call sites already have the config available on the resolved tool object.

2. **Non-2xx returns error string, not throw** — The executor returns `'Webhook error status=...'` on non-2xx rather than throwing. The action engine's `try/catch` in both call sites treats any thrown error as a failure and uses `fallback_message`. For webhook responses, returning the HTTP status in the result string is more informative than the generic fallback.

3. **AbortError propagates** — Timeout is signaled by AbortError propagation so the caller can distinguish `status = 'timeout'` from `status = 'error'` in `action_logs`, consistent with how GHL executors handle timeouts.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1. custom-webhook executor module | 877e1be | src/lib/custom-webhook/execute-webhook.ts |
| 2. wire into execute-action.ts | fcb8061 | src/lib/action-engine/execute-action.ts |
| 3. update both call sites | c0c786d | route.ts, dispatch-event.ts |
| 4. build verification | (no new files — build clean) | — |

## Deviations from Plan

None - plan executed exactly as written. The `toolConfig` design described in Task 2 matched what was implemented.

## Known Stubs

None in this plan. The `send_sms` case in execute-action.ts remains a stub from before this plan and is being handled by parallel plan 30-01.

## Self-Check: PASSED

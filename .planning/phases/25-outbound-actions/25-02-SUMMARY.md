---
phase: 25-outbound-actions
plan: 02
subsystem: action-engine, manychat
tags: [manychat, vitest, tdd, action-engine, outbound]

# Dependency graph
requires:
  - phase: 25-outbound-actions-plan-01
    provides: Wave 0 RED tests, migration 028, database types, execute-action.ts TODO stub
provides:
  - src/lib/manychat/client.ts (shared fetch wrapper)
  - src/lib/manychat/subscriber-id.ts (subscriber ID resolver)
  - src/lib/manychat/set-field.ts (OUTBOUND-01 executor)
  - src/lib/manychat/add-tag.ts (OUTBOUND-02 executor)
  - src/lib/manychat/trigger-flow.ts (OUTBOUND-03 executor)
  - src/lib/manychat/send-message.ts (OUTBOUND-04 executor)
  - execute-action.ts wired with 4 real case arms (TODO stub replaced)
affects: [25-outbound-actions-plan-03, action-engine, manychat-dispatch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mirror GHL executor pattern: one file per action type, (params, credentials) => Promise<string>"
    - "resolveSubscriberId helper: 3-path fallback (top-level, .payload, .user.id) without coercion"
    - "Shared fetch wrapper (client.ts) with AbortController 5s timeout, Bearer auth, JSON content-type"
    - "Wave 0 TDD: RED tests written in Plan 01 now transition GREEN in Plan 02"

key-files:
  created:
    - src/lib/manychat/client.ts
    - src/lib/manychat/subscriber-id.ts
    - src/lib/manychat/set-field.ts
    - src/lib/manychat/add-tag.ts
    - src/lib/manychat/trigger-flow.ts
    - src/lib/manychat/send-message.ts
  modified:
    - src/lib/action-engine/execute-action.ts

key-decisions:
  - "resolveSubscriberId added as separate module: 3-path fallback (params.subscriber_id, params.payload.subscriber_id, params.user.id) with no coercion per RESEARCH.md Pitfall 3"
  - "Executors use resolveSubscriberId instead of direct params.subscriber_id check — consistent fallback behavior across all 4 executors"
  - "send-message.ts builds v2 dynamic-block when caller passes text convenience param instead of full data block"
  - "execute-action.ts structural typing compatibility: GhlCredentials and ManychatCredentials share the same shape (apiKey, locationId) — no cast needed"

# Metrics
duration: 58min
completed: 2026-05-07
---

# Phase 25 Plan 02: Outbound Actions — ManyChat Executor Implementation Summary

**4 ManyChat outbound executors + shared client wrapper + subscriber-ID resolver + dispatcher case arms replacing the TODO stub — all Wave 0 RED tests now GREEN**

## Performance

- **Duration:** ~58 min
- **Started:** 2026-05-07T11:51:00Z
- **Completed:** 2026-05-07T12:01:31Z
- **Tasks:** 5
- **Files modified:** 7

## Accomplishments

- `src/lib/manychat/client.ts` — shared fetch wrapper with 5s AbortController timeout, Bearer auth, JSON content-type; `manychatFetch` + `manychatFetchJson<T>` matching GHL client pattern exactly
- `src/lib/manychat/subscriber-id.ts` — `resolveSubscriberId` reads 3 fallback paths without coercion; throws `'subscriber_id is required'` when none resolve
- 4 executor files created (set-field, add-tag, trigger-flow, send-message) — each ~30–45 lines, single-line success strings, no `\n` (Vapi parser constraint), throw-on-failure convention
- `src/lib/action-engine/execute-action.ts` — TODO(25-02) stub block replaced with 4 real case arms + 4 imports; TypeScript exhaustiveness check still passes for all 10 action_type enum values

## RED → GREEN Transition Table

| Test File | Production File | Requirement |
|-----------|----------------|-------------|
| tests/manychat/client.test.ts (5 tests) | src/lib/manychat/client.ts | OUTBOUND-client |
| tests/manychat/set-field.test.ts (5 tests) | src/lib/manychat/set-field.ts | OUTBOUND-01 |
| tests/manychat/add-tag.test.ts (4 tests) | src/lib/manychat/add-tag.ts | OUTBOUND-02 |
| tests/manychat/trigger-flow.test.ts (4 tests) | src/lib/manychat/trigger-flow.ts | OUTBOUND-03 |
| tests/manychat/send-message.test.ts (5 tests) | src/lib/manychat/send-message.ts | OUTBOUND-04 |
| tests/manychat/execute-action-manychat.test.ts (5 tests) | src/lib/action-engine/execute-action.ts | OUTBOUND-dispatcher |
| tests/manychat/dispatch-event.test.ts (manychat_add_tag canary) | execute-action.ts + add-tag.ts | end-to-end |
| tests/manychat/channel-actions.test.ts (already green) | — (bridge sync, Plan 01) | bridge invariants |

**Total manychat tests:** 78 passing across 11 test files.

## Task Commits

1. **Task 1: ManyChat REST client wrapper** — `ee682df`
2. **Task 2: subscriber-id resolver helper** — `4069be3`
3. **Task 3: 4 outbound executors** — `11046fc`
4. **Task 4: Wire executors into dispatcher** — `c7eb7ff`
5. **Task 5: Final verification** — (no code changes; verification only)

## Verification Results

- `npm run build` exits 0 (TypeScript strict, exhaustiveness check, all 10 action_type values handled)
- `npx vitest run tests/manychat/` exits 0 (78/78 tests passing)
- `execute-action.ts` contains no `TODO(25-02)` or `'ManyChat executor not yet wired'` strings
- `execute-action.ts` contains `case 'manychat_set_field':`, `case 'manychat_add_tag':`, `case 'manychat_trigger_flow':`, `case 'manychat_send_message':`

## Deviations from Plan

None — plan executed exactly as written. All 4 executors use `resolveSubscriberId` per Task 3 spec; all files match the plan's exact bodies.

## Known Stubs

None. All 4 ManyChat outbound action types are fully wired end-to-end.

## Pre-existing Baseline Issue (out of scope)

`tests/action-engine.test.ts > ACTN-12 > logAction() does not throw on Supabase insert error` fails with `expected null to be undefined`. This failure existed before Plan 02 (confirmed by checking the test against the Plan 01 commit baseline). It is unrelated to Phase 25's work. Logged to deferred-items.

## Next Phase Readiness

- Plan 03 writes `25-HUMAN-UAT.md` to capture live ManyChat verification (real API key, real subscriber, all 4 actions)
- All 4 OUTBOUND-01..04 requirements have passing unit tests
- The inbound-webhook chain (`/api/manychat/webhook` → `dispatchManychatEvent` → `executeAction`) is complete once migration 028 is pushed and a `tool_configs` row is configured

---

*Phase: 25-outbound-actions*
*Completed: 2026-05-07*

## Self-Check: PASSED

- FOUND: src/lib/manychat/client.ts
- FOUND: src/lib/manychat/subscriber-id.ts
- FOUND: src/lib/manychat/set-field.ts
- FOUND: src/lib/manychat/add-tag.ts
- FOUND: src/lib/manychat/trigger-flow.ts
- FOUND: src/lib/manychat/send-message.ts
- FOUND commit ee682df (client wrapper)
- FOUND commit 4069be3 (subscriber-id helper)
- FOUND commit 11046fc (4 executors)
- FOUND commit c7eb7ff (dispatcher wiring)
- npm run build: exits 0
- npx vitest run tests/manychat/: 78/78 tests passing

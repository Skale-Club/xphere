---
plan: 85-02
phase: 85
subsystem: tests
tags: [vitest, unit-tests, calls, server-actions, mocking]
dependency_graph:
  requires: [85-01]
  provides: [test coverage for getUnifiedCalls and getUnifiedCall]
  affects: [tests/calls-actions.test.ts]
tech_stack:
  added: []
  patterns: [chainable proxy thenable mock, vi.mock hoisting, maybeSingle Promise override]
key_files:
  created: []
  modified:
    - tests/calls-actions.test.ts
decisions:
  - buildFakeClient returns per-table proxies; maybeSingle returns Promise directly (not proxy) to match action await pattern
  - Proxy thenable pattern (then property) enables await proxy to resolve with canned result
  - Legacy getCalls todo stubs preserved unchanged at bottom of file
metrics:
  duration: 8m
  completed_date: "2026-05-19"
  tasks_completed: 2
  files_modified: 1
---

# Phase 85 Plan 02: Vitest Test Suite for getUnifiedCalls and getUnifiedCall Summary

## One-liner

8 Vitest unit tests for getUnifiedCalls/getUnifiedCall using chainable thenable proxy mock with per-table canned responses.

## What Was Built

Replaced the stub-only `tests/calls-actions.test.ts` with a full test suite for the two unified calls server actions. All 13 legacy `getCalls` todo stubs were preserved unchanged.

### Test Coverage

| Test | Description | Result |
|------|-------------|--------|
| Test 1 | No filters returns rows array, total count, page=1, pageSize=20 | PASS |
| Test 2 | type="ai" filter — result rows all have call_type ai | PASS |
| Test 3 | type="human" filter — result rows all have call_type human | PASS |
| Test 4 | direction="inbound" filter — result rows all inbound | PASS |
| Test 5 | getUnifiedCall(id) returns correct UnifiedCallWithContact shape | PASS |
| Test 6 | getUnifiedCall("nonexistent") returns null | PASS |
| Test 7 | Supabase error returns empty rows and total 0 | PASS |
| Test 8 | Contact enrichment when contact_id is present | PASS |

**Total: 8 passed, 13 todo (preserved legacy stubs), exit 0**

### buildFakeClient Design

- Takes `{ unifiedCalls, contacts }` with per-table `FakeTableResult` (data, count, error)
- Each table returns a chainable proxy where all chain methods (`select`, `order`, `eq`, `in`, `or`, `range`, etc.) return `this`
- `maybeSingle()` returns a `Promise.resolve(result)` directly (not the proxy) — this is the critical difference because `getUnifiedCall` does `await proxy.maybeSingle()` not `await proxy`
- Proxy is made thenable via `proxy.then = (resolve) => Promise.resolve(result).then(resolve)` so `await proxy` works for `getUnifiedCalls` chain

## Vitest Run Results

```
Test Files  1 passed (1)
     Tests  8 passed | 13 todo (21)
  Start at  07:48:16
  Duration  1.06s
```

Full suite: pre-existing failures in 19 other test files (accounts-actions, auth/callback, brand, agents, etc.) — none are related to this plan's changes. `tests/calls-actions.test.ts` is clean.

## Decisions Made

- `maybeSingle()` must return a `Promise` directly instead of the proxy — the action `await`s it at the end of the chain, so returning `this` would cause the chain resolution to happen at the parent thenable level, masking the result
- Used `vi.fn(() => proxy)` for all chain methods to allow spy inspection if needed in future
- Two separate proxies per `from()` call (unified_calls vs contacts) avoids state leakage between tables

## Deviations from Plan

None — plan executed exactly as written. All 8 tests implemented and passing on first run.

## Known Stubs

None — all test behaviors specified in the plan are fully implemented and asserting real behavior.

## Self-Check: PASSED

- `tests/calls-actions.test.ts` exists and contains 8 new passing tests
- Commit `e37f346` exists: `test(85-02): add Vitest unit tests for getUnifiedCalls and getUnifiedCall`
- Legacy getCalls stubs preserved (13 todos)
- `npx vitest run tests/calls-actions.test.ts` exits 0

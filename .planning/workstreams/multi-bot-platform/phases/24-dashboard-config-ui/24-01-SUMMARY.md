---
phase: 24-dashboard-config-ui
plan: 01
subsystem: integrations
tags: [manychat, server-actions, tdd, crypto, abort-controller]

# Dependency graph
requires:
  - phase: 22-foundation
    provides: createManychatChannel + deleteManychatChannel in actions.ts, manychat_channels table with encrypted_api_key/webhook_secret columns
provides:
  - getManychatChannel(): RLS-scoped getter returning ManychatChannelForDisplay (never encrypted_api_key)
  - testManychatConnection(): decrypt + fetch GET /fb/page/getFlows with 5s AbortController timeout
  - MANYCHAT_PAYLOAD_TEMPLATE: canonical 8-key as const object for UI copy paste
  - ManychatChannelForDisplay type exported from actions.ts
affects: [24-02-config-page-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [AbortController timeout pattern for external API calls, maybeSingle for optional single-row queries, decrypt-before-fetch credential pattern]

key-files:
  created: []
  modified:
    - src/app/(dashboard)/integrations/manychat/actions.ts
    - tests/manychat/channel-actions.test.ts

key-decisions:
  - "getManychatChannel uses maybeSingle (not single) to return null cleanly when no channel is configured — caller treats null as 'not connected'"
  - "testManychatConnection uses single() for encrypted_api_key lookup since UNIQUE(org_id) guarantees at most one row per org"
  - "MANYCHAT_PAYLOAD_TEMPLATE exported as plain as const object — UI uses JSON.stringify for display, not a pre-stringified value"
  - "testManychatConnection gate sequence: auth check -> channel row check -> decrypt -> fetch — fail-fast at each step with typed error messages"

patterns-established:
  - "AbortController + setTimeout(5000) + clearTimeout in finally: wraps any external API call with 5s timeout"
  - "Decrypt-before-fetch: encrypted_api_key never leaves the server action — decrypted inline only for the fetch call"
  - "Auth gate returns null (not error) for read actions, returns { success: false, error } for mutation/test actions"

requirements-completed: [CHANNEL-02, CHANNEL-03, CHANNEL-04]

# Metrics
duration: 25min
completed: 2026-05-06
---

# Phase 24 Plan 01: ManyChat Channel Server Actions Summary

**TDD-implemented getManychatChannel (RLS-scoped getter), testManychatConnection (decrypt + 5s-timeout fetch to ManyChat API), and MANYCHAT_PAYLOAD_TEMPLATE constant as server-side contracts for the config UI.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-06T19:44:00Z
- **Completed:** 2026-05-06T19:47:00Z
- **Tasks:** 2 (Task 1: RED, Task 2: GREEN)
- **Files modified:** 2

## Accomplishments

- Extended `tests/manychat/channel-actions.test.ts` with 10 new tests across CHANNEL-02, CHANNEL-03, CHANNEL-04 (committed RED, then GREEN)
- Extended `src/app/(dashboard)/integrations/manychat/actions.ts` with 4 new exports:
  - `ManychatChannelForDisplay` type
  - `MANYCHAT_PAYLOAD_TEMPLATE` as const (8 keys matching canonical template)
  - `getManychatChannel()` — RLS-scoped, selects safe display columns only via maybeSingle
  - `testManychatConnection()` — auth gate, single() lookup, decrypt, fetch with AbortController 5s timeout, structured error returns

## Test Results

- Channel-specific test file: 16/16 passing (CHANNEL-01 through CHANNEL-05)
- Full suite: 195/196 passing (pre-existing ACTN-12 failure in action-engine.test.ts, unrelated to this plan)
- Build: compiled successfully, 0 TypeScript errors

## Commits

| Hash | Type | Description |
|------|------|-------------|
| ce80844 | test | add RED tests for CHANNEL-02, CHANNEL-03, CHANNEL-04 |
| 690d88f | feat | implement getManychatChannel, testManychatConnection, MANYCHAT_PAYLOAD_TEMPLATE |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all exported functions are fully implemented. MANYCHAT_PAYLOAD_TEMPLATE contains real ManyChat variable syntax (`{{user.id}}`, etc.) not placeholders.

## Self-Check: PASSED

- `src/app/(dashboard)/integrations/manychat/actions.ts` — FOUND and verified exports
- `tests/manychat/channel-actions.test.ts` — FOUND with 16 passing tests
- Commit ce80844 — FOUND (RED test commit)
- Commit 690d88f — FOUND (GREEN implementation commit)
- `encrypted_api_key` never returned from `getManychatChannel` — CONFIRMED by grep (only selected in testManychatConnection, never returned)
- `decrypt()` called before `fetch` in `testManychatConnection` — CONFIRMED

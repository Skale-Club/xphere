---
phase: 13-outbound-reply-routing
plan: 01
subsystem: api
tags: [meta, facebook, messenger, instagram, fetch, vitest, tdd]

# Dependency graph
requires:
  - phase: 11-meta-webhook
    provides: channel_metadata field names (igsid/sender_id/page_id) set by process-event.ts
  - phase: 10-meta-oauth
    provides: META_GRAPH_VERSION constant and encrypted_page_access_token in meta_channels
provides:
  - sendMetaMessage function (sole Meta Send API caller, isolated for vi.mock)
  - 8 RED test stubs defining METAINBOX-03 behavioral contract
affects: [13-02-outbound-reply-routing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sendMetaMessage wrapper: AbortController 10s timeout, typed JSON cast, discriminated union return"
    - "buildMockSupabase: per-table chained query mock builder for Supabase client"
    - "it.todo() RED stubs: Vitest exits 0, Plan 02 converts to GREEN implementations"

key-files:
  created:
    - src/lib/meta/send-message.ts
    - tests/outbound-reply-routing.test.ts
  modified: []

key-decisions:
  - "it.todo() stubs used for RED phase — Vitest exits 0, tests activate in Plan 02"
  - "META_GRAPH_VERSION imported from oauth.ts — v21.0 never hardcoded"
  - "AbortController 10s timeout on Meta fetch — synchronous send (not after()) because admin waits for confirmation"
  - "buildMockSupabase exports fixtures so Plan 02 can import them rather than duplicate"

patterns-established:
  - "Send lib isolation: sendMetaMessage is the only place that calls Meta Send API — vi.mock target"
  - "Supabase mock builder: per-table branching with vi.fn().mockReturnThis() for chained queries"

requirements-completed: [METAINBOX-03]

# Metrics
duration: 5min
completed: 2026-05-04
---

# Phase 13 Plan 01: Outbound Reply Routing — Wave 0 Safety Net Summary

**sendMetaMessage fetch wrapper (Bearer auth, 10s timeout, typed error union) plus 8 it.todo() RED stubs that define the METAINBOX-03 contract for Plan 02**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-04T21:57:00Z
- **Completed:** 2026-05-05T02:00:21Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `src/lib/meta/send-message.ts` — sole caller of Meta Graph Send API, typed discriminated union return, 10s AbortController timeout, `META_GRAPH_VERSION` imported (never hardcoded)
- Created `tests/outbound-reply-routing.test.ts` — 8 `it.todo()` stubs covering all METAINBOX-03 branches: widget, messenger, instagram, token-revoked (190), other Meta error, channel_not_configured, unauth, DB fail
- `buildMockSupabase` helper with per-table chained query support exported for Plan 02 reuse
- `npm run build` passes; `npx vitest run tests/outbound-reply-routing.test.ts` exits 0 (8 todo)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/lib/meta/send-message.ts** - `4978fcf` (feat)
2. **Task 2: Write RED test stubs** - `d801ff4` (test)

## Files Created/Modified
- `src/lib/meta/send-message.ts` - sendMetaMessage function: POST to Meta Graph Send API, AbortController timeout, typed union return
- `tests/outbound-reply-routing.test.ts` - 8 it.todo() stubs + buildMockSupabase builder + fixture constants + exports for Plan 02

## Decisions Made
- Used `it.todo()` for RED stubs so Vitest exits 0 — plan prompt explicitly required this (overrides plan body which described failing assertions)
- `buildMockSupabase` exported from test file so Plan 02 can import and extend rather than duplicate the mock builder
- No `after()` in send-message — synchronous send is correct because the admin reply UI waits for send confirmation

## Deviations from Plan

None - plan executed exactly as written (critical_notes from prompt clarified it.todo() is the correct RED stub pattern).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 0 safety net is in place: `sendMetaMessage` is mockable via `vi.mock('@/lib/meta/send-message')`
- Plan 02 must: extend the POST route SELECT to include `channel, channel_metadata`; branch on channel; query `meta_channels`; decrypt token; call `sendMetaMessage`; return structured errors
- Plan 02 converts all 8 `it.todo()` stubs to `it()` implementations — tests must be GREEN before merge
- Build is clean, no regressions

## Self-Check: PASSED
- `src/lib/meta/send-message.ts` — FOUND
- `tests/outbound-reply-routing.test.ts` — FOUND
- commit `4978fcf` — FOUND
- commit `d801ff4` — FOUND

---
*Phase: 13-outbound-reply-routing*
*Completed: 2026-05-04*

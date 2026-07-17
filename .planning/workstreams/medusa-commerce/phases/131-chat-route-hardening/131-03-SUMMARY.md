---
phase: 131-chat-route-hardening
plan: 03
subsystem: api
tags: [rate-limiting, redis, chat, widget, next.js, vitest]

# Dependency graph
requires:
  - phase: 131-01
    provides: "rateLimit(key, limit, windowSeconds, opts?: { failMode?: 'open'|'memory'|'closed' }) tri-state extension with bounded in-process memory fallback"
provides:
  - "src/lib/request-ip.ts — shared getClientIp(request) helper used by both public widget routes"
  - "Full R1-R5 rate-limit matrix wired into POST /api/chat/{token} in contract §7 order: R1 -> R2 -> body/schema -> R3/R4 -> org resolve -> R5"
  - "message capped at 4,000 chars (400 'message too long'); maxDuration raised to 60"
  - "R4 (chat:newsess:{ip}, 10/hour) closes the bypass where a bogus/expired/org-mismatched sessionId would otherwise mint an unbounded number of new sessions + chat_sessions rows"
affects: [132-medusa-provider-read-tools, 134-cart-write-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getClientIp(request: Request): string shared by chat + widget-config routes (single hardened x-forwarded-for first-hop parse)"
    - "rateLimited() helper returns Response.json({error:'rate_limited'}, {status:429, headers: CORS_HEADERS}) — every 429 in the route is plain JSON with CORS, never a stream"
    - "Early org-independent getSession() call reused for both the R3/R4 gate and the later session resolve/create step (avoids a second Redis round trip)"
    - "createNewSession(orgId) deduplicates what were two byte-identical session-create blocks"

key-files:
  created:
    - src/lib/request-ip.ts
  modified:
    - src/app/api/widget/[token]/config/route.ts
    - src/app/api/chat/[token]/route.ts
    - tests/chat-api.test.ts

key-decisions:
  - "R4 gates ANY session-create path (fresh, bogus/expired sessionId, org-mismatched sessionId) — not just the narrow 'no incoming sessionId' reading — per the research's Pitfall 4 analysis and the plan's explicit instruction. The org-mismatch branch double-charges R3 (it presented a live session) then R4 (it also creates one); accepted as a negligible edge-case cost."
  - "getSession is called exactly once (before org resolve, org-independent) and reused for the later session resolve/create step, instead of a second Redis round trip — matches the plan's explicit interface guidance."
  - "The two byte-identical session-create blocks (Redis-miss/org-mismatch create, and no-sessionId create) were deduplicated into a single createNewSession(orgId) helper while touching this code, as flagged by research."

requirements-completed: [CHT-02, CHT-03]

# Metrics
duration: 9min
completed: 2026-07-17
---

# Phase 131 Plan 03: Chat Route Rate-Limit Matrix + Message Cap Summary

**Wired the full R1-R5 rate-limit matrix (contract §7) into `POST /api/chat/{token}` in the exact order R1 -> R2 -> body/schema -> R3/R4 -> org resolve -> R5, capped `message` at 4,000 chars, raised `maxDuration` to 60, and extracted `src/lib/request-ip.ts` as the shared IP helper for both public widget routes.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-17T14:00:46Z (approx., first commit after 131-01 completion)
- **Completed:** 2026-07-17T14:09:05Z
- **Tasks:** 3 (Tasks 2 and 3 executed as TDD: RED + GREEN each)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Created `src/lib/request-ip.ts` exporting `getClientIp(request: Request): string` and adopted it in `src/app/api/widget/[token]/config/route.ts`, removing the last inline `x-forwarded-for` copy from that route (the chat route never had one — it now imports the same helper directly).
- Wired R1 (`chat:ip:{ip}` 20/60s, memory) and R2 (`chat:ip:day:{ip}` 200/86400s, memory) immediately after token extraction — before body parse, before `createServiceRoleClient()` is ever called. Verified by a test asserting `createServiceRoleClient` is never invoked when R1 denies.
- Wired R5 (`chat:org:{orgId}` 300/60s, open failMode) immediately after the org-active check, before the URL-rules check.
- Wired R3 (`chat:sess:{sessionId}` 10/60s, memory) on the resume path and R4 (`chat:newsess:{ip}` 10/3600s, memory) on every session-create path: no incoming sessionId, a bogus/expired sessionId (Redis miss), and an org-mismatched sessionId — the last two closing the bypass a narrow "no sessionId only" reading would have left open.
- Deduplicated the two byte-identical session-create code blocks into a single `createNewSession(orgId)` helper; `getSession` is now called exactly once (org-independent, before org resolve) and its result reused for the later resolve/create decision.
- `message` capped at 4,000 chars via `.max(4000, 'message too long')` on the existing zod schema (400 comes free from the existing `safeParse` handler); `maxDuration` raised from 10 to 60 with a comment explaining it's Coolify build-output metadata only (no runtime behavior change).
- Every 429 response is `Response.json({error:'rate_limited'}, {status:429, headers: CORS_HEADERS})` via a shared `rateLimited()` helper — plain JSON, never a stream, always with CORS headers.
- Extended `tests/chat-api.test.ts` with 12 new tests (11 existing -> 22 total): R1/R2/R3/R4(x3)/R5 denial + argument assertions, the happy fresh-create path asserting all four applicable limiter calls plus a streamed 200, and the message-cap/maxDuration tests. All 22 pass.
- `npx vitest run tests/rate-limit.test.ts tests/chat-api.test.ts tests/custom-webhook.test.ts tests/widget-config-route.test.ts` — 3 files green (36 tests), `tests/custom-webhook.test.ts` unchanged (15 `it.todo`, owned by the concurrently-executing 131-02 plan in a separate worktree — not touched here).
- `npm run build` passes clean (CLAUDE.md's hard gate).

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract shared getClientIp helper and adopt it in the widget config route** - `79a9159c` (feat)
2. **Task 2 RED: failing tests for R1/R2/R5 + message cap + maxDuration** - `d90e18ce` (test)
3. **Task 2 GREEN: R1/R2 pre-org and R5 post-org rate limits, message cap, maxDuration 60** - `e6d5d0b4` (feat)
4. **Task 3 RED: failing tests for R3/R4 session rate limits** - `1668dc88` (test)
5. **Task 3 GREEN: R3/R4 wired, session-create paths deduplicated** - `7001a186` (feat)

_Tasks 2 and 3 were executed as TDD (RED -> GREEN); no REFACTOR commit was needed beyond the create-block deduplication that was part of Task 3's GREEN implementation itself (per the plan's explicit design)._

## Files Created/Modified
- `src/lib/request-ip.ts` - New. `getClientIp(request: Request): string` — shared first-hop `x-forwarded-for` extraction for public routes behind Traefik.
- `src/app/api/widget/[token]/config/route.ts` - Imports and uses `getClientIp(request)`, replacing the inline parse. No other behavior change (the `rateLimit` call there stays 3-arg / fail-open, unchanged from 131-01).
- `src/app/api/chat/[token]/route.ts` - `maxDuration` 10 -> 60; `ChatRequestSchema.message` gains `.max(4000, 'message too long')`; new `rateLimited()` helper; R1/R2 inserted right after token extraction; R5 inserted right after the org-active check; R3/R4 inserted right after body destructure using an early `getSession` call; the session resolve/create block restructured to reuse that `existingSession` and to fold the two identical create blocks into `createNewSession(orgId)`.
- `tests/chat-api.test.ts` - `@/lib/rate-limit` mocked via `vi.hoisted`; `makeRequest` gained an `ip` param (default `203.0.113.9`) sent as `x-forwarded-for`; `beforeEach` defaults `mockRateLimit` to allow-all; new `'rate limits (CHT-02)'` describe (9 tests: R1 denial+args, R2 denial+args, R5 denial+args, R3 denial+args, R4 denial x3 (fresh/bogus/mismatch), happy fresh-create path) and new `'message cap + duration (CHT-03)'` describe (3 tests).

## Decisions Made
- **R4 gating breadth — wide, not narrow.** Followed the research's Pitfall 4 recommendation and the plan's explicit instruction: R4 fires on ANY path that will create a session (no sessionId, Redis-miss on a presented sessionId, and org-mismatch on a presented sessionId), not just the "no sessionId" case named in the CONTEXT parenthetical. Without this, an attacker sending a fresh random `sessionId` on every request would bypass R4 entirely.
- **Single early `getSession` call, reused.** Matches the plan's recommended placement (research: "org-independent Redis read... safe to call BEFORE org resolve") — avoids a second Redis round trip and keeps R3/R4 ahead of the org DB lookup as required by the CONTEXT-locked sequence.
- **Create-block deduplication folded into Task 3's GREEN commit** rather than a separate REFACTOR commit, since the restructuring needed to reuse `existingSession` and the deduplication were the same physical edit to the same lines — splitting them would have meant re-touching the same code twice for no behavioral benefit.

## Deviations from Plan

None - plan executed exactly as written. All five rate-limit rules use the exact keys, limits, windows, and failModes specified in contract §7; the message cap, `maxDuration`, and `getClientIp` extraction match the plan's `<action>` blocks verbatim; all acceptance-criteria greps (key presence, ordering, failMode counts, `ensureDbSession` call count) pass exactly as specified.

## Issues Encountered

None. The concurrent 131-02 plan (SSRF guard on `execute-webhook.ts`) is being executed in a separate worktree against `src/lib/custom-webhook/execute-webhook.ts` and `tests/custom-webhook.test.ts` — neither file was read or touched by this plan, and `git add` was scoped to this plan's five files on every commit (`git status --short` after each commit showed no stray staged files).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CHT-02 and CHT-03 fully satisfied. Combined with 131-01 (CHT-01), the chat route now has: a `failMode`-aware limiter, the full R1-R5 matrix in the CONTEXT-locked order, a 4,000-char message cap, and `maxDuration = 60`.
- Phase 131 is complete pending 131-02 (CHT-04, SSRF guard) landing from its separate worktree — that plan's files were never touched here.
- The `getClientIp` helper and the `rateLimited()` / `createNewSession()` patterns established in this plan are directly reusable by Phase 134's fail-closed commerce write budgets (R7/R8), which build on the same `rateLimit(..., { failMode: 'closed' })` mechanism from 131-01.
- No blockers.

---
*Phase: 131-chat-route-hardening*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: src/lib/request-ip.ts
- FOUND: src/app/api/widget/[token]/config/route.ts
- FOUND: src/app/api/chat/[token]/route.ts
- FOUND: tests/chat-api.test.ts
- FOUND: commit 79a9159c (feat: extract getClientIp helper)
- FOUND: commit d90e18ce (test: RED — R1/R2/R5 + message cap + maxDuration)
- FOUND: commit e6d5d0b4 (feat: GREEN — R1/R2/R5 + message cap + maxDuration)
- FOUND: commit 1668dc88 (test: RED — R3/R4 session rate limits)
- FOUND: commit 7001a186 (feat: GREEN — R3/R4 session rate limits)

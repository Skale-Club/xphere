---
phase: 131-chat-route-hardening
plan: 01
subsystem: api
tags: [rate-limiting, redis, resilience, testing, vitest]

# Dependency graph
requires: []
provides:
  - "rateLimit(key, limit, windowSeconds, opts?: { failMode?: 'open'|'memory'|'closed' }) — tri-state failure behavior on top of the existing Redis fixed-window counter"
  - "Bounded in-process memory fallback (module-level Map, sweep-then-evict at 10,000 entries) usable by any future 'memory' or 'closed' caller"
  - "Repaired tests/widget-config-route.test.ts baseline (was 2/4 failing, now 4/4)"
affects: [131-02-custom-webhook-ssrf, 131-03-chat-route-limits, 134-cart-write-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onRedisUnavailable(key, limit, windowSeconds, failMode) single switch consumed by both fail-open seams (isReady guard + catch block)"
    - "Test-only introspection exports (__resetMemoryStoreForTests, __memoryStoreSizeForTests) for module-level state that vitest's module caching would otherwise leak across tests"
    - "vi.hoisted + vi.mock('@/lib/redis', () => ({ default: mockRedis })) to make Redis-down/Redis-error paths deterministic regardless of local REDIS_URL reachability"

key-files:
  created:
    - tests/rate-limit.test.ts
  modified:
    - src/lib/rate-limit.ts
    - tests/widget-config-route.test.ts

key-decisions:
  - "Implemented the memory fallback as a fixed-window Map (per CONTEXT.md's locked decision), not the 'token-bucket' wording used in REQUIREMENTS.md/contract — semantically equivalent for this purpose, documented in a code comment so it isn't 'fixed' into a mismatch later."
  - "Widget-config baseline repair: added a rate-limit mock to tests/widget-config-route.test.ts and updated only the test assertions (8-field response shape, 11-column select string) — the route source was NOT touched, satisfying Wave 0's 'repair, don't refactor' requirement."

requirements-completed: [CHT-01]

# Metrics
duration: 15min
completed: 2026-07-17
---

# Phase 131 Plan 01: Rate-Limit Baseline Repair + failMode Extension Summary

**Extended `src/lib/rate-limit.ts` with a `failMode: 'open'|'memory'|'closed'` tri-state (bounded in-process Map fallback, sweep-then-evict at 10,000 keys) while keeping all 5 existing 3-arg call sites byte-identical, and repaired the 2 pre-existing stale assertions in `tests/widget-config-route.test.ts`.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-17T13:45:00Z (approx.)
- **Completed:** 2026-07-17T13:56:03Z
- **Tasks:** 2 (Task 2 executed as TDD: RED + GREEN)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Repaired the Wave 0 baseline: `tests/widget-config-route.test.ts` now passes 4/4 (was 2/4), by mocking `@/lib/rate-limit` and updating expectations to the route's current 8-field/11-column shape — the route itself was untouched.
- Extended `rateLimit` with an optional 4th argument `opts?: { failMode?: 'open' | 'memory' | 'closed' }`, default `'open'`, routing both existing fail-open seams (`!redis.isReady` guard and the catch-all) through a single `onRedisUnavailable` switch.
- Added a bounded, module-level fixed-window memory fallback (`memoryRateLimit`) for `failMode: 'memory'` — sweeps expired entries then evicts oldest-inserted once size exceeds 10,000, so it cannot grow unbounded.
- Added `failMode: 'closed'` returning `{ allowed: false, remaining: 0, resetAt: 0 }` — the mechanism Phase 134's fail-closed commerce write budgets (R7/R8) will build on.
- Created `tests/rate-limit.test.ts` (10 tests, all passing) covering: backward-compat 3-arg calls at both failure seams, `closed` at both seams, `memory` counting/window-reset/seam-2-fallback/key-isolation/bounding, and the Redis-healthy path staying identical regardless of `failMode`.
- Verified all 5 pre-existing `rateLimit` call sites remain untouched, 3-arg, byte-identical (grep + `git diff --name-only` scope check).
- `npm run build` passes clean (type gate per xphere CLAUDE.md).

## Task Commits

Each task was committed atomically:

1. **Task 1: Repair the 2 stale widget-config baseline tests** - `b04c3a28` (test)
2. **Task 2 RED: failing tests for failMode extension** - `1f0a1c3b` (test)
3. **Task 2 GREEN: implement failMode tri-state + bounded memory fallback** - `91528487` (feat)

_Task 2 was executed as TDD (RED → GREEN); no REFACTOR commit was needed — a lint cleanup (removed an unused `afterEach` import) was folded into the GREEN commit._

## Files Created/Modified
- `src/lib/rate-limit.ts` - Added `RateLimitFailMode` type, `opts?: { failMode? }` 4th param (default `'open'`), module-level bounded `memoryStore` Map + `memoryRateLimit`/`onRedisUnavailable` helpers, and `__resetMemoryStoreForTests`/`__memoryStoreSizeForTests` test-only exports. Both existing fail-open seams now delegate to `onRedisUnavailable`.
- `tests/rate-limit.test.ts` - New file, 10 tests, `@/lib/redis` mocked via `vi.hoisted` (never touches live Redis); covers open/memory/closed × both failure seams, window reset via fake timers, key isolation, 10,000-entry bounding, and the Redis-healthy path.
- `tests/widget-config-route.test.ts` - Added a `vi.mock('@/lib/rate-limit')` stub; updated the 2 stale test expectations (response JSON + `select` column string) to match the route's current 8-field/11-column behavior (greeting fields from migration 1148). Route source untouched.

## Decisions Made
- **Fixed-window over "token-bucket" wording**: CONTEXT.md's locked decision specifies a fixed-window Map; REQUIREMENTS.md/contract language says "token-bucket." Followed CONTEXT.md (more recent, more specific, user-approved) and left an explanatory comment in `rate-limit.ts` so the wording drift isn't mistaken for a bug later.
- **LRU via re-insertion, not a separate structure**: `memoryRateLimit` deletes-then-sets each accessed key so Map iteration order tracks recency, avoiding a second data structure for eviction ordering.
- **Bounding strategy**: sweep expired entries first (cheap, likely clears most of the overage), then evict oldest-inserted only if still over the cap — avoids evicting live, in-window counters when an expired sweep would have sufficed.

## Deviations from Plan

None - plan executed exactly as written. The plan's exact interface (`opts?: { failMode?: RateLimitFailMode }`, the `memoryRateLimit`/`onRedisUnavailable`/test-hook shapes) was followed verbatim per the orchestrator's locked ruling. One minor lint-driven adjustment (removing an unused `afterEach` import from the RED-phase test file) is not a deviation from plan behavior — it was folded into the GREEN commit as test hygiene.

## Issues Encountered
None. `npx tsc --noEmit -p tsconfig.json` surfaces pre-existing, unrelated type errors in `tests/workflows/schema-validate.test.ts` and `tests/workflows/yaml-to-flow.test.ts` (missing vitest globals typing for those two files) — confirmed out of scope (untouched by this plan, not present in `git diff`, and `npm run build` — the actual CLAUDE.md-mandated gate — passes clean because `next build` does not typecheck the `tests/` tree). No action taken per the deviation rules' scope boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CHT-01 fully satisfied; the `failMode` mechanism is ready for 131-02 (SSRF guard, independent of this) and 131-03 (chat route R1–R5, which will call `rateLimit(..., { failMode: 'memory' })` for R1–R4 and default `'open'` for R5 per the CONTEXT decision).
- The bounded memory fallback is also the foundation Phase 134 needs for fail-closed commerce write budgets (`failMode: 'closed'`).
- No blockers. Widget-config baseline is green, so 131-03's planned IP-helper extraction into that same route file will start from a clean test suite.

---
*Phase: 131-chat-route-hardening*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: src/lib/rate-limit.ts
- FOUND: tests/rate-limit.test.ts
- FOUND: tests/widget-config-route.test.ts
- FOUND: commit b04c3a28 (test: repair widget-config baseline)
- FOUND: commit 1f0a1c3b (test: RED — failing failMode tests)
- FOUND: commit 91528487 (feat: GREEN — failMode implementation)

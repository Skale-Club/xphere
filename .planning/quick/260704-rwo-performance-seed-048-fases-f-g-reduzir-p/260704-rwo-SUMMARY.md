---
phase: 260704-rwo-performance-seed-048-fases-f-g-reduzir-p
plan: 01
subsystem: performance
tags: [supabase-realtime, polling, react, nextjs, bundle-optimization, seed-048]

# Dependency graph
requires:
  - phase: 260704-pr3 (SEED-048 Phases A+C)
    provides: Calls detail dialog fetch dedup + parallelized dashboard layout/org/RBAC round-trips
  - phase: 260704-r15 (SEED-048 Phase B)
    provides: Lazy-loaded Twilio Voice SDK + dynamic-import wrappers
  - phase: 260704-r5t (SEED-048 Phases D+E)
    provides: Parallelized dashboard feed, SQL-bounded counts, deduped org-id lookups, paginated CSV export
provides:
  - Knowledge Manager admin page reacts to a Supabase realtime subscription on global_knowledge_sync_jobs instead of polling router.refresh() every 5 seconds
  - Evolution WhatsApp QR setup flow self-terminates its 8s poll once the connection reaches 'connected'
  - Incoming-call contact lookups cached per phone number with a 5-minute TTL, avoiding redundant /api/voice/contact-by-phone fetches for repeat callers
  - next.config.ts opts @phosphor-icons/react into Next.js's optimizePackageImports
  - New migration 1244 (not yet applied) enabling realtime on global_knowledge_sync_jobs and global_knowledge_notion_roots
affects: [performance, admin-knowledge, integrations-evolution, calls]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "postgres_changes realtime subscription replacing setInterval+router.refresh polling (mirrors campaigns/contact-status-board.tsx precedent)"
    - "Module-level Map cache with TTL for client-component fetch deduplication across mount/unmount cycles"
    - "Interval callback self-clearing on terminal status, in addition to unmount cleanup"

key-files:
  created:
    - supabase/migrations/1244_global_knowledge_notion_realtime.sql
  modified:
    - src/components/admin/global-knowledge/knowledge-manager.tsx
    - src/components/integrations/evolution-setup-flow.tsx
    - src/components/calls/incoming-call-banner.tsx
    - next.config.ts

key-decisions:
  - "Knowledge Manager subscribes to a single channel on global_knowledge_sync_jobs (not a second channel on global_knowledge_notion_roots) since job status transitions are the actual signal a sync finished; roots update as a side effect via complete_global_knowledge_root_sync()"
  - "Migration 1244 created but NOT applied (no db push / MCP apply_migration run) — left for operator, consistent with migrations 1241-1243 from the prior quick task"
  - "Only @phosphor-icons/react added to optimizePackageImports — lucide-react, date-fns, and recharts are already in Next.js 16's built-in default-optimized list, so adding them would be redundant"
  - "package.json's --webpack build flag and a bundle-analyzer dependency both explicitly deferred (out of scope for a quick task / already covered by next experimental-analyze)"

requirements-completed: [SEED-048-F, SEED-048-G]

# Metrics
duration: 15min
completed: 2026-07-05
---

# Quick Task 260704-rwo: SEED-048 Phases F+G (Realtime & Polling Cleanup) Summary

**Replaced Knowledge Manager's 5s router.refresh() polling with a Supabase realtime subscription, added a self-terminating stop condition to the Evolution QR poll, cached incoming-call contact lookups with a 5-minute TTL, and opted @phosphor-icons/react into Next.js's optimizePackageImports — closing out all of SEED-048 (Phases A-G).**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-05
- **Tasks:** 2/2 completed
- **Files modified:** 4 modified, 1 created

## Accomplishments

- Knowledge Manager admin page no longer runs a full-page `router.refresh()` every 5 seconds while a Notion sync is active — it now subscribes to `postgres_changes` on `global_knowledge_sync_jobs` filtered by `connection_id` and refreshes once per actual change event.
- Evolution WhatsApp QR setup flow stops polling `getEvolutionQRCode()` the moment the connection reaches `'connected'`, instead of continuing to hit the server every 8 seconds indefinitely while the component happens to still be mounted.
- Incoming-call banner caches `/api/voice/contact-by-phone` lookups in a module-level `Map` keyed by phone number with a 5-minute TTL — repeat callers within a session no longer trigger redundant fetches.
- `next.config.ts` now declares `experimental.optimizePackageImports: ['@phosphor-icons/react']`, the one broadly-imported icon package not already covered by Next.js 16's built-in default optimization list.
- **This plan closes out all of SEED-048 (Phases A through G)** — Phases A/C shipped as quick task 260704-pr3, Phase B as 260704-r15, Phases D/E as 260704-r5t, and this plan (260704-rwo) ships the final F/G phases.

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace Knowledge Manager polling with realtime + add stop condition to Evolution QR poll** - `3767a3c0` (feat)
2. **Task 2: Cache incoming-call contact lookups + add optimizePackageImports** - `2e5474e4` (feat)

_Note: this plan's SUMMARY/STATE metadata commit follows separately per the execution protocol._

## Files Created/Modified

- `supabase/migrations/1244_global_knowledge_notion_realtime.sql` - New idempotent migration adding `global_knowledge_sync_jobs` and `global_knowledge_notion_roots` to the `supabase_realtime` publication with `REPLICA IDENTITY FULL` on both. **NOT applied to remote DB by this execution.**
- `src/components/admin/global-knowledge/knowledge-manager.tsx` - Replaced the `setInterval(() => router.refresh(), 5_000)` polling effect with a `supabase.channel(...).on('postgres_changes', ...)` subscription on `global_knowledge_sync_jobs`, cleaned up via `supabase.removeChannel` on unmount/dependency change.
- `src/components/integrations/evolution-setup-flow.tsx` - `QRCodeCard`'s auto-refresh `useEffect` now inlines the `getEvolutionQRCode()` call inside the interval tick, checks `res.data.status === 'connected'`, and calls `clearInterval` the moment that status is reached (plus continues clearing on unmount as before). The standalone `refresh()` helper is unchanged and still backs the "Refresh now" button.
- `src/components/calls/incoming-call-banner.tsx` - Added a module-level `contactLookupCache` (`Map<string, { name: string | null; fetchedAt: number }>`) with a 5-minute TTL (`CONTACT_LOOKUP_TTL_MS`), checked before firing the `/api/voice/contact-by-phone` fetch; cache is populated after every successful fetch regardless of cache hit/miss path.
- `next.config.ts` - Added `experimental: { optimizePackageImports: ['@phosphor-icons/react'] }` to the exported `NextConfig`, after `turbopack: {}`.

## Decisions Made

- **Single-channel realtime subscription for Knowledge Manager:** rather than subscribing to both `global_knowledge_sync_jobs` and `global_knowledge_notion_roots`, only the jobs table is subscribed to. A job transitioning to `succeeded`/`failed` is the real signal a sync finished (roots update as a side effect via `complete_global_knowledge_root_sync()`), so one channel captures the state transition without over-engineering a second subscription for a rarely-changing admin screen.
- **Migration 1244 created but not applied:** per explicit task constraints, no `npx supabase db push` or Supabase MCP `apply_migration` call was made. **This migration still needs to be applied by the operator** before the realtime subscription will receive `postgres_changes` events in any environment (local, staging, or production) — until then, the Knowledge Manager's realtime channel will subscribe successfully but never receive events, since the tables aren't yet part of the `supabase_realtime` publication.
- **Only `@phosphor-icons/react` added to `optimizePackageImports`:** `lucide-react`, `date-fns`, and `recharts` are already covered by Next.js 16's built-in default-optimized package list, so adding them explicitly would be redundant. Confirmed via the installed Next.js 16.2.6 docs bundled in `node_modules`.
- **`package.json`'s `--webpack` build flag left untouched:** deferred per task scope — determining whether this was a deliberate workaround requires git-history archaeology beyond a quick task.
- **No bundle-analyzer dependency added:** Next.js 16.1+ already ships a built-in `next experimental-analyze` CLI command requiring no new devDependency, so this was deferred as unnecessary rather than risky.

## Deviations from Plan

None - plan executed exactly as written. All four target files matched the plan's `verified_live_state` section byte-for-byte (confirmed by reading each file before editing), so no re-derivation or adjustment was needed.

## Verification Results

- `npm run build` passed with zero type errors after Task 1 (Knowledge Manager + Evolution QR changes).
- `npm run build` passed with zero type errors after Task 2 (incoming-call cache + next.config.ts) — this is the authoritative final build covering all changes from both tasks.
- `grep -n "setInterval" src/components/admin/global-knowledge/knowledge-manager.tsx` returns no matches — polling fully replaced by realtime.
- `grep -n "clearInterval" src/components/integrations/evolution-setup-flow.tsx` shows `clearInterval` called both inside the tick callback (on `status === 'connected'`) and in the effect's cleanup function on unmount.
- `git status` / `git diff --stat` after both commits confirms only the five files declared in this plan's `files_modified` were touched — no file from SEED-048 Phases A-E was modified.
- No existing migration file under `supabase/migrations/` was edited — only the new `1244_global_knowledge_notion_realtime.sql` file was added.

**Not verified (no automated UI test exists in this repo for these flows, and this is a backend/behavioral change with no new UI to visually inspect):**
- Manual confirmation that the Admin > Global Knowledge page updates via websocket instead of a 5-second polling cadence in the network tab.
- Manual confirmation that the Evolution QR poll stops issuing `getEvolutionQRCode` calls once the "Connected" card appears.
- Manual confirmation that a second incoming call from the same number within 5 minutes skips the `/api/voice/contact-by-phone` fetch (verified via code review only, per the plan's own verification guidance for this item).

These require either a live Notion sync, a live Evolution WhatsApp connection, or a live incoming Twilio call, none of which are reproducible in a build-only quick-task execution.

## Outstanding Follow-Up (Operator Action Required)

**Migration 1244 must be applied before the realtime feature works.** Run one of:
- `npx supabase db push`, or
- Supabase MCP `apply_migration`

This was intentionally not done as part of this execution per explicit task constraints. Until applied, the Knowledge Manager's new realtime subscription will connect but receive no `postgres_changes` events (silent no-op, not an error) — sync progress will only become visible again on the next full page load/navigation, since the old polling fallback has been fully removed. This mirrors the same pending-migration pattern from the prior quick task 260704-r5t (migrations 1241-1243, also not yet applied).

## Issues Encountered

None.

## SEED-048 Completion

This plan's completion closes out **all of SEED-048** (system performance / Calls page latency):

| Phases | Quick Task | Commit(s) | Status |
|--------|-----------|-----------|--------|
| A + C | 260704-pr3 | 570a3bcd, de5d7591 | Complete |
| B | 260704-r15 | 2ed200f5 | Complete |
| D + E | 260704-r5t | b2e13468 | Complete |
| F + G | 260704-rwo (this plan) | 3767a3c0, 2e5474e4 | Complete |

Three migrations remain pending operator application across the initiative: `1241`, `1242`, `1243` (from 260704-r5t) and now `1244` (from this plan).

---
*Quick task: 260704-rwo*
*Completed: 2026-07-05*

## Self-Check: PASSED

All created/modified files confirmed present on disk:
- FOUND: supabase/migrations/1244_global_knowledge_notion_realtime.sql
- FOUND: src/components/admin/global-knowledge/knowledge-manager.tsx
- FOUND: src/components/integrations/evolution-setup-flow.tsx
- FOUND: src/components/calls/incoming-call-banner.tsx
- FOUND: next.config.ts
- FOUND: .planning/quick/260704-rwo-performance-seed-048-fases-f-g-reduzir-p/260704-rwo-SUMMARY.md

All commit hashes confirmed in git log:
- FOUND: 3767a3c0 (Task 1)
- FOUND: 2e5474e4 (Task 2)

---
phase: 260704-pr3-performance-seed-048-fases-a-c-eliminar-
plan: 01
subsystem: performance
tags: [nextjs, react-server-components, supabase, promise-all, react-memo]

# Dependency graph
requires:
  - phase: seed-048
    provides: performance audit identifying the calls-detail waterfall and dashboard-layout sequential round-trips
provides:
  - Calls detail dialog that reuses hub-fetched rows instead of re-fetching on every open
  - Parallelized calls/action_logs queries in CallDetailAi
  - Removed redundant call_logs re-fetch in CallDetailHuman
  - Stable close() callback identity in CallDetailDialog scoped to the call param
  - Memoized UnifiedCallRow to prevent cascading re-renders
  - Dialog-body Suspense skeleton (CallDetailSkeleton)
  - Dashboard layout batching call_routing_chains + inbox_unread_count into one Promise.all
  - getOrgSettings accepting a pre-resolved org id to skip a redundant RPC
  - getRbacContext parallelizing platform_admins + org_members lookups
  - useUnreadCount server-seeded initial value
  - OrgSwitcher server-preloaded org list
affects: [calls, dashboard-layout, org-settings, rbac]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side row lookup with server fallback: reuse already-fetched list data instead of re-fetching a single row by id"
    - "Promise.all batching of independent Supabase queries that share a resolved dependency (org id, user id)"
    - "cache()-wrapped helper accepting an optional pre-resolved id to avoid duplicate RPC calls across the same request"
    - "useState(initialValue) seeding for client hooks fed by a server-computed value, with existing effect/realtime logic untouched"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/calls/(hub)/page.tsx
    - src/app/(dashboard)/calls/loading.tsx
    - src/components/calls/call-detail-ai.tsx
    - src/components/calls/call-detail-human.tsx
    - src/components/calls/call-detail-dialog.tsx
    - src/components/calls/unified-call-timeline.tsx
    - src/app/(dashboard)/layout.tsx
    - src/lib/org/settings.ts
    - src/lib/rbac/server.ts
    - src/hooks/use-unread-count.ts
    - src/components/layout/sidebar.tsx
    - src/components/layout/org-switcher.tsx
    - src/components/layout/top-bar.tsx

key-decisions:
  - "getUnifiedCall(id) kept as-is (select('*')) since it is now only a rare fallback path — narrowing columns there would just re-derive the view's full shape with no real savings"
  - "UnifiedCallRow memo comparator uses explicit fields (id/status/notes) instead of JSON.stringify since unified_calls has no updated_at column"
  - "call_routing_chains, inbox_unread_count, and getUserOrgs all folded into the layout's existing call_settings/twilio_phone_numbers Promise.all since none of them depend on each other's results"

patterns-established:
  - "Server components pass already-fetched list data down to detail sub-components with a fallback single-row fetch for cases outside the current page (deep links)"
  - "Optional pre-resolved-id parameters on cache()-wrapped org/settings helpers to let callers dedupe RPC calls across a single request"

requirements-completed: [SEED-048-A, SEED-048-C]

# Metrics
duration: ~35min
completed: 2026-07-04
---

# Phase 260704-pr3: Performance — SEED-048 Fases A+C Summary

**Eliminated the Calls detail dialog's duplicate-fetch waterfall and parallelized the dashboard layout's org/RBAC/routing-chain round-trips, with zero behavior, schema, or RLS changes.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-04T18:40:00Z (approx)
- **Completed:** 2026-07-04T22:56:12Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- Calls detail dialog now opens from already-loaded hub data (`result.rows`) with a fallback `getUnifiedCall(id)` fetch only when the row isn't on the current page — eliminates a guaranteed extra round-trip on every dialog open for the common case.
- `CallDetailAi` no longer waits on a sequential `calls` fetch before firing `action_logs` — both now run in `Promise.all`, using `call.external_id` (already `vapi_call_id`) as the join key. The `calls` select is also narrowed to just `transcript_turns, started_at`.
- `CallDetailHuman`'s entire `call_logs` re-fetch was removed — `ended_at` is sourced directly from the already-fetched unified call row.
- `CallDetailDialog`'s `close()` callback is now stable across unrelated searchParams changes (timeline filters/pagination), only changing identity when the `call` param itself changes.
- `UnifiedCallRow` is wrapped in `React.memo` with an explicit field comparator (id/status/notes) to stop cascading re-renders from sibling state changes.
- Added a `CallDetailSkeleton` Suspense fallback around the dialog body so it shows a skeleton instead of a blank flash while resolving.
- Dashboard layout now fetches `call_routing_chains`, `inbox_unread_count`, and (separately) `getUserOrgs()` alongside the existing `call_settings`/`twilio_phone_numbers` batch instead of sequentially — one fewer avoidable round-trip per navigation.
- `getOrgSettings` accepts an optional pre-resolved org id, letting `layout.tsx` reuse the org id `getActiveOrg()` already resolved instead of re-invoking `get_current_org_id()`.
- `getRbacContext` now runs the `platform_admins` and `org_members` lookups in parallel (both only depend on already-known `user.id`/`orgId`) instead of sequentially.
- `useUnreadCount` accepts an `initialCount` seed so the sidebar badge paints with a server-computed value instead of always starting at 0; realtime/refetch logic is unchanged.
- `OrgSwitcher` accepts a server-preloaded `initialOrgs` list (threaded from `layout.tsx` through `TopBar`) so the dropdown opens instantly instead of lazy-fetching on first click.

## Task Commits

Each task was committed atomically:

1. **Task 1: Calls detail dialog — eliminate the duplicate-fetch waterfall (Phase A)** - `570a3bcd` (perf)
2. **Task 2: Dashboard layout, org, and RBAC — parallelize the per-navigation tax (Phase C)** - `de5d7591` (perf)

_Note: used `perf(260704-pr3): ...` commit type since these are pure performance refactors — no new feature, no bug fix, no test-only change._

## Files Created/Modified

- `src/app/(dashboard)/calls/(hub)/page.tsx` - `CallDetail` now accepts `rows` and does a client-side lookup before falling back to `getUnifiedCall`; added `CallDetailSkeleton` + `Suspense` boundary around the AI/Human detail body
- `src/app/(dashboard)/calls/loading.tsx` - added a comment pointing to the in-page Suspense boundary for the dialog body
- `src/components/calls/call-detail-ai.tsx` - parallelized `calls`/`action_logs` fetch via `Promise.all`, narrowed `calls` select
- `src/components/calls/call-detail-human.tsx` - removed redundant `call_logs` re-fetch, sources `ended_at` from `call`
- `src/components/calls/call-detail-dialog.tsx` - narrowed `close()` callback's dependency array to `sp.get('call')`
- `src/components/calls/unified-call-timeline.tsx` - wrapped `UnifiedCallRow` in `React.memo` with explicit comparator
- `src/app/(dashboard)/layout.tsx` - folded `call_routing_chains` + `inbox_unread_count` into the existing `Promise.all`; passes `activeOrgId` to `getOrgSettings`; fetches and threads `initialOrgs`/`initialUnreadCount` to `Sidebar`/`TopBar`
- `src/lib/org/settings.ts` - `getOrgSettings` accepts optional pre-resolved `orgId` parameter
- `src/lib/rbac/server.ts` - `getRbacContext` parallelizes `platform_admins` and `org_members` lookups
- `src/hooks/use-unread-count.ts` - `useUnreadCount` accepts optional `initialCount` seed
- `src/components/layout/sidebar.tsx` - threads `initialUnreadCount` prop through `Sidebar`/`SidebarBody`
- `src/components/layout/org-switcher.tsx` - accepts optional `initialOrgs` prop, exports `Org` type
- `src/components/layout/top-bar.tsx` - threads `initialOrgs` through `TopBarProps`/`MobileMenu` to both `OrgSwitcher` call sites

## Decisions Made

- Kept `getUnifiedCall(id)`'s `select('*')` unchanged — it's now only invoked on the rare fallback path (row not in the current page), and narrowing it would require re-deriving a manual column list identical to the view's shape with no real savings.
- Used an explicit field comparator (`id`, `status`, `notes`) for the `UnifiedCallRow` memo instead of `JSON.stringify`, since `unified_calls` has no `updated_at` column (confirmed against `src/types/database.ts`) and those three fields are the only ones that can change after initial load.
- Folded `call_routing_chains`, `inbox_unread_count`, and `getUserOrgs()` into/alongside the layout's existing `call_settings`/`twilio_phone_numbers` `Promise.all` since none of the five results depend on each other — this keeps the diff smallest while eliminating all avoidable sequential awaits in one pass.
- `getOrgSettings(orgId?)` treats `undefined` as "self-resolve via RPC" (back-compat for the other call site in `metric-deals-won.tsx`, which is unchanged) and explicit `null`/a string as "use this value directly" — preserving existing behavior for every caller not touched by this plan.

## Deviations from Plan

None - plan executed exactly as written. The plan's file list, interfaces, and step-by-step instructions matched the live codebase precisely (confirmed via direct reads of every file before editing), so no bugs, missing functionality, or blocking issues were discovered during implementation.

## Issues Encountered

The plan's `<files_to_read>` pointed at a `.planning/quick/.../260704-pr3-PLAN.md` path that did not exist in this git worktree (the worktree's `.planning/` was created before this quick task's plan was written in the main checkout). Resolved by reading the plan from the main repository's `.planning/` directory and copying it into the worktree's `.planning/quick/` folder so the SUMMARY and any future references live in the correct location within this worktree. No code or plan content was affected.

## User Setup Required

None - no external service configuration required. This is a pure server-side/client-side refactor with no new environment variables, migrations, or dashboard configuration.

## Next Phase Readiness

- Both Phase A (Calls detail waterfall) and Phase C (dashboard layout/org/RBAC parallelization) from SEED-048 are complete.
- `npm run build` passes with zero type errors after both tasks, confirming no regressions.
- No RLS/org-scoping behavior changed — `get_current_org_id()` remains the sole resolver used across `getActiveOrg`, `getOrgSettings`, and `getRbacContext`; the new `orgId` parameter on `getOrgSettings` only lets callers reuse an already-resolved value, it never introduces an alternate resolution path.
- Manual browser verification (Network tab confirming no duplicate `getUnifiedCall`/`calls`/`call_logs` requests, sidebar badge/org switcher painting without a flash) was not performed as part of this automated execution — recommended as a follow-up smoke test before considering SEED-048 Fases A/C fully closed out.

---
*Phase: 260704-pr3-performance-seed-048-fases-a-c-eliminar-*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 13 modified source files and the SUMMARY.md file verified present on disk. Both task commits (`570a3bcd`, `de5d7591`) verified present in git history.

---
phase: 260704-r5t-performance-seed-048-fases-d-e-paraleliz
plan: 01
subsystem: performance
tags: [supabase, postgres, nextjs, server-actions, indexes, n+1]

# Dependency graph
requires:
  - phase: none
    provides: n/a (standalone quick task against existing dashboard/campaigns/pipeline/companies/contacts actions)
provides:
  - Parallelized dashboard activity feed queries (Promise.all across messages/calls/deals/reviews)
  - Single getRbacContext() resolution per pipeline mutation (createOpportunity/updateOpportunity) instead of requirePermission() + a second get_current_org_id RPC
  - SQL-bounded + single-pass campaign contact-count aggregation in getCampaigns
  - Combined getAccountOpportunitiesAndActivities loader deduping the linked-contacts query on the company detail page
  - Paginated (non-truncating) exportContactsCsv via .range()
  - Three new idempotent index migrations (1241-1243), not yet applied to remote DB
affects: [calls-page-performance-followups, database-migration-hygiene]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parallel fan-out with per-source async fetch functions feeding Promise.all, merged post-hoc (activity feed pattern)"
    - "Resolve RBAC context once (getRbacContext) and derive both the permission check and orgId from it, instead of requirePermission() + a second RPC"
    - "Bound aggregate JS fallback queries with .in(ids) derived from an already-fetched parent list, instead of unbounded org-wide fetch + filter"
    - "Combined multi-result loader functions to share one expensive sub-query (linked contact ids) across what were previously independent parallel calls"

key-files:
  created:
    - supabase/migrations/1241_contact_channel_identities_provider_index.sql
    - supabase/migrations/1242_conversation_messages_org_created_index.sql
    - supabase/migrations/1243_call_logs_org_direction_date_index.sql
  modified:
    - src/app/(dashboard)/actions.ts
    - src/app/(dashboard)/pipeline/actions.ts
    - src/app/(dashboard)/campaigns/actions.ts
    - src/app/(dashboard)/companies/[id]/actions.ts
    - src/app/(dashboard)/companies/[id]/page.tsx
    - src/app/(dashboard)/contacts/actions.ts

key-decisions:
  - "Kept getAccountOpportunities/getAccountActivities exported unchanged (not converted to thin wrappers) because account-detail-sheet.tsx calls getAccountOpportunities independently without activities; only page.tsx (the sole dual-consumer) was switched to the new combined getAccountOpportunitiesAndActivities function"
  - "getCampaigns fetch of campaign_contacts changed from Promise.all-parallel to sequential (campaigns first, then contacts .in(campaignIds)) since the contacts query now depends on which campaign ids are being displayed after the channel filter"
  - "Migrations 1241-1243 created but intentionally NOT applied (no db push / MCP apply_migration run) per explicit constraint; flagged below as required operator follow-up"

requirements-completed: [SEED-048-D, SEED-048-E]

# Metrics
duration: 15min
completed: 2026-07-04
---

# Phase 260704-r5t Plan 01: SEED-048 Phases D+E Performance Refactor Summary

**Parallelized dashboard activity feed fetches, SQL-bounded campaign contact aggregation, deduped company-detail and pipeline-action queries, paginated CSV export, and three new composite index migrations — pure performance refactor with one explicit bug fix (CSV truncation).**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-04T23:41:02Z
- **Completed:** 2026-07-04T23:56:xxZ
- **Tasks:** 3
- **Files modified:** 9 (6 modified, 3 created)

## Accomplishments

- `getActivityFeed` (dashboard home) now launches its 4 source-table queries (messages, calls, opportunity activities, reviews) concurrently via `Promise.all` instead of sequentially, with identical filter/shape/sort semantics.
- `createOpportunity` / `updateOpportunity` in the pipeline actions each resolve org id and the `pipeline.manage` permission from a single `getRbacContext()` call instead of `requirePermission()` (internal RPC) followed by a second explicit `get_current_org_id` RPC.
- `getCampaigns` replaced an unbounded org-wide `campaign_contacts` fetch + O(campaigns × contacts) repeated `.filter()` scans with a single `.in(campaignIds)`-bounded fetch and one O(contacts) map-building pass.
- Company detail page (`companies/[id]/page.tsx`) now calls a new combined `getAccountOpportunitiesAndActivities` loader instead of independently invoking `getAccountOpportunities` and `getAccountActivities` in parallel — the linked-contact-id resolution now runs once per page load instead of twice.
- `exportContactsCsv` paginates through all contacts via `.range()` (1000-row pages) instead of a hard `.limit(5000)`, fixing silent truncation for orgs above 5000 contacts.
- Added three new idempotent (`IF NOT EXISTS`) index migrations: `contact_channel_identities(provider, contact_id)`, `conversation_messages(org_id, created_at DESC)`, `call_logs(org_id, direction, started_at DESC)`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Parallelize dashboard activity feed + dedupe pipeline org-id resolution** - `53284e8c` (perf)
2. **Task 2: Aggregate campaign contact counts in SQL + dedupe company-detail contact lookups** - `d76dc2ec` (perf)
3. **Task 3: Fix CSV export truncation + add index migrations** - `b2e13468` (fix)

_Note: this SUMMARY and STATE.md updates are captured in a separate metadata commit per the executor protocol._

## Files Created/Modified

- `src/app/(dashboard)/actions.ts` - `getActivityFeed` restructured into 4 async fetch functions (`fetchMessages`, `fetchCalls`, `fetchDeals`, `fetchReviews`) run via `Promise.all`; sort/slice logic unchanged.
- `src/app/(dashboard)/pipeline/actions.ts` - `createOpportunity`/`updateOpportunity` now import and use `getRbacContext`/`can` from `@/lib/rbac/server` for a single org-id + permission resolution; `deleteOpportunity`/`moveOpportunity` untouched (still use `requirePermission`).
- `src/app/(dashboard)/campaigns/actions.ts` - `getCampaigns` restructured: fetch campaigns first, then `campaign_contacts` narrowed via `.in('campaign_id', campaignIds)`, aggregated into a `Map` in one pass instead of repeated `.filter()` calls.
- `src/app/(dashboard)/companies/[id]/actions.ts` - Added private `getLinkedContactIds` helper (shared by `getAccountOpportunities`, `getAccountActivities`, and the new combined loader) and new exported `getAccountOpportunitiesAndActivities(accountId)` returning `{ opportunities, activities }` from one linked-contacts resolution.
- `src/app/(dashboard)/companies/[id]/page.tsx` - Switched from `Promise.all([getAccountDetail, getAccountOpportunities, getAccountActivities])` to `Promise.all([getAccountDetail, getAccountOpportunitiesAndActivities])`, destructuring both result sets from the combined call.
- `src/app/(dashboard)/contacts/actions.ts` - `exportContactsCsv` replaced the single `.limit(5000)` fetch with a `.range()` pagination loop (1000-row pages, `ContactRow[]` accumulator); `getDefinitions` kicked off before the loop and awaited just before use to preserve parallelism.
- `supabase/migrations/1241_contact_channel_identities_provider_index.sql` (new) - `CREATE INDEX IF NOT EXISTS idx_contact_channel_identities_provider ON public.contact_channel_identities (provider, contact_id)`.
- `supabase/migrations/1242_conversation_messages_org_created_index.sql` (new) - `CREATE INDEX IF NOT EXISTS idx_conversation_messages_org_created ON public.conversation_messages (org_id, created_at DESC)`.
- `supabase/migrations/1243_call_logs_org_direction_date_index.sql` (new) - `CREATE INDEX IF NOT EXISTS idx_call_logs_org_direction_date ON public.call_logs (org_id, direction, started_at DESC)`.

## Decisions Made

- Kept `getAccountOpportunities` and `getAccountActivities` exported with unchanged public signatures rather than converting them to thin wrappers around the combined function. Grep confirmed `account-detail-sheet.tsx` calls `getAccountOpportunities` independently (without `getAccountActivities`), so collapsing both into always-combined calls would have changed that consumer's fetch shape unnecessarily. Only `page.tsx` — the genuine dual-consumer — was updated to call the new combined `getAccountOpportunitiesAndActivities` function.
- `getCampaigns`'s two queries intentionally changed from parallel (`Promise.all`) to sequential, since the narrowed `campaign_contacts` fetch needs the campaign ids resolved first (a correctness-preserving tradeoff explicitly called out in the plan: one bounded sequential round-trip pair beats two parallel unbounded ones at scale).
- Migrations 1241/1242/1243 were created but deliberately not applied to any database (no `npx supabase db push`, no Supabase MCP `apply_migration` call) per the task's explicit constraint.

## Deviations from Plan

None - plan executed exactly as written. The `createOpportunity`/`updateOpportunity` permission-check replacement matches `can()`'s existing internal logic exactly (platform admins and owners always pass; admin/member resolve against `role_permissions`; everyone else denied), verified by reading `src/lib/rbac/server.ts` before implementing.

## Issues Encountered

- The plan was authored and its PLAN.md committed on the main working tree, but this execution runs inside a separate git worktree (`.claude/worktrees/agent-a8d0dfb7faaf41989`) that did not yet have the `.planning/quick/260704-r5t-...` directory checked out. Resolved by copying `260704-r5t-PLAN.md` into the worktree's `.planning/quick/` path before execution, and writing this SUMMARY.md into the same worktree-local path (`.planning/quick/260704-r5t-performance-seed-048-fases-d-e-paraleliz/260704-r5t-SUMMARY.md`) so it lands in the correct location once this worktree's branch is merged/integrated.
- `src/components/assistants/assistant-mappings-table.tsx`, shown as modified in the parent session's git status, does not exist as a pending change in this worktree (worktree started fresh from commit `ebf096d4`) — it was not touched by this plan and is unrelated to SEED-048.

## User Setup Required

**Database migrations are NOT applied.** Three new migration files exist under `supabase/migrations/` (1241, 1242, 1243) but were intentionally not pushed to the remote database, per this task's explicit constraint. The operator must apply them via one of:

```bash
npx supabase db push
```

or the Supabase MCP `apply_migration` tool, once per migration file:
- `supabase/migrations/1241_contact_channel_identities_provider_index.sql`
- `supabase/migrations/1242_conversation_messages_org_created_index.sql`
- `supabase/migrations/1243_call_logs_org_direction_date_index.sql`

All three use `CREATE INDEX IF NOT EXISTS`, so they are safe to run multiple times and safe to apply in any order relative to each other.

## Next Phase Readiness

- SEED-048 Phase D (system-wide N+1/sequential-fetch fixes outside Calls) and Phase E (query narrowing + index hygiene) are both complete for the scope of this plan.
- No file under `src/app/(dashboard)/calls/` or `src/components/calls/` was touched — confirmed via `git diff --name-status` against the worktree's base commit.
- No existing migration file was edited — confirmed via `git diff --name-status`, all three new migration files show as newly created (`create mode`), not modifications.
- `npm run build` passed after each individual task and in the final combined check — zero new TypeScript errors.
- Outstanding: the three new index migrations still need to be applied to the remote database by the operator (see "User Setup Required" above) before their query-performance benefit is realized in production.

---
*Phase: 260704-r5t-performance-seed-048-fases-d-e-paraleliz*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 10 claimed files verified present on disk (6 modified files, 3 new migrations, this SUMMARY.md). All 3 claimed commit hashes (`53284e8c`, `d76dc2ec`, `b2e13468`) verified present in `git log --oneline --all`.

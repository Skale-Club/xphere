---
phase: 23-inbound-routing
plan: 03
subsystem: api
tags: [supabase, rls, server-actions, manychat, routing-rules, next-cache]

# Dependency graph
requires:
  - phase: 23-inbound-routing/23-01
    provides: manychat_rules table migration + database.ts type widening
provides:
  - createManychatRule server action (insert with RLS org scoping)
  - updateManychatRule server action (partial update, undefined-field exclusion)
  - deleteManychatRule server action (RLS-scoped delete)
  - getManychatRules server action (priority-ordered list for Phase 26 UI)
affects: [26-rules-ui, phase-26]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Partial update pattern: build update object excluding undefined fields before calling .update()"
    - "RLS-implicit org scoping: never pass org_id in insert, rely on WITH CHECK constraint"
    - "Server action auth gate: getUser() check returns { error: 'Not authenticated.' } on null"
    - "Post-mutation cache invalidation: revalidatePath for both /integrations/manychat and /integrations/manychat/rules"

key-files:
  created:
    - src/app/(dashboard)/integrations/manychat/rule-actions.ts
  modified: []

key-decisions:
  - "updateManychatRule builds update payload conditionally (data.field !== undefined) so partial updates never null-out unmentioned columns"
  - "getManychatRules returns [] (not an error) on auth failure or query error to keep Phase 26 UI resilient"
  - "org_id NOT set in createManychatRule — locked Phase 22 decision, RLS WITH CHECK populates it automatically"

patterns-established:
  - "Partial update: only include keys in Update object where input !== undefined — prevents unintended null writes"
  - "getManychatRules returns typed ManychatRuleRow[] ordered by priority ASC — ready for Phase 26 rules list page"

requirements-completed: [ROUTING-01, ROUTING-02]

# Metrics
duration: 10min
completed: 2026-05-06
---

# Phase 23 Plan 03: Rule-Actions Server Actions Summary

**Four 'use server' exports for manychat_rules CRUD — partial-update pattern, RLS-scoped, all 8 RED tests turned GREEN**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-06T19:34:00Z
- **Completed:** 2026-05-06T19:44:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Implemented `createManychatRule` with RLS-auto-populated org_id (no manual set), priority default 0, isActive default true
- Implemented `updateManychatRule` with partial-update pattern (undefined fields excluded from UPDATE payload)
- Implemented `deleteManychatRule` with `.delete().eq('id', id)` chain
- Implemented `getManychatRules` returning rows ordered by priority ASC for Phase 26 UI
- All 8 tests in `tests/manychat/rule-actions.test.ts` transitioned from RED to GREEN
- `npm run build` exits 0, TypeScript clean

## Task Commits

1. **Task 1: Implement rule-actions.ts** - `fa7b52c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/app/(dashboard)/integrations/manychat/rule-actions.ts` - Four 'use server' exports for manychat_rules CRUD + typed getter

## Decisions Made

- `updateManychatRule` builds the `Update` object by checking `!== undefined` for each field — this directly satisfies the RED test asserting `updateArg.condition` is `undefined` when not passed
- `getManychatRules` returns `[]` (never throws) on auth/query failure — keeps Phase 26 UI resilient to empty state
- Both `/integrations/manychat` and `/integrations/manychat/rules` are revalidated after each mutation to pre-invalidate the Phase 26 rules page cache before it exists

## Deviations from Plan

None - plan executed exactly as written. Implementation code copied precisely from plan action block.

## Issues Encountered

Pre-existing failure in `tests/action-engine.test.ts` (1 test: `logAction` resolves to null instead of undefined) — confirmed present before this plan's changes via `git stash`. Out of scope; logged as pre-existing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROUTING-01 and ROUTING-02 backend surfaces are complete
- Phase 26 can import `createManychatRule`, `updateManychatRule`, `deleteManychatRule`, `getManychatRules` directly
- Phase 23 Plan 04 (if any) can proceed; the rule CRUD layer is stable

---
*Phase: 23-inbound-routing*
*Completed: 2026-05-06*

---
phase: 132-medusa-provider-read-tools
plan: 01
subsystem: database
tags: [postgres, enum-migration, typescript, integrations-registry, supabase]

# Dependency graph
requires: []
provides:
  - "Migration 1259: 'medusa' added to integration_provider enum + all nine medusa_* action_type values (idempotent, no txn wrapper, no seed rows)"
  - "database.ts integration_provider union widened at all 3 hand-maintained occurrences (Enums, integrations Row, integrations Insert)"
  - "IntegrationForDisplay.provider union (actions.ts) widened to include 'medusa'"
  - "INTEGRATION_REGISTRY 'medusa' entry: Server URL (location_id), Publishable Key (publishable_key), Connection Token (api_key); panelType 'api_key', category 'crm', testable false"
affects: [132-02, 132-03, 132-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Enum widening: hand-edit database.ts unions in place (not a raw supabase gen types regen) — 4 occurrences per new provider (3 in database.ts + 1 in actions.ts's IntegrationForDisplay), plus any exhaustive Record<Provider,...> consumers"

key-files:
  created:
    - supabase/migrations/1259_medusa_integration.sql
    - tests/medusa-migration.test.ts
    - tests/medusa-registry.test.ts
  modified:
    - src/types/database.ts
    - "src/app/(dashboard)/integrations/actions.ts"
    - src/lib/integrations/registry.ts
    - src/components/integrations/integration-form.tsx

key-decisions:
  - "action_type union in database.ts deliberately left untouched (owned by 132-04, which pairs it with the exhaustive-switch dispatcher cases)"
  - "Registry category reused 'crm' (no 'commerce' category exists yet; adding one is out of scope per research Open Q2)"
  - "Fixed a downstream build break in integration-form.tsx's exhaustive PROVIDER_LABELS Record<Provider,string> (Rule 3 - blocking, not listed in the plan's files_modified but directly caused by widening Provider)"

requirements-completed: [MED-01, MED-02]

duration: 12min
completed: 2026-07-17
---

# Phase 132 Plan 01: Medusa Migration + Provider Registry Summary

**One idempotent SQL migration lands 10 new enum values (medusa + 9 medusa_* action types); the four hand-maintained provider-union call sites in database.ts/actions.ts and a downstream exhaustive Record in integration-form.tsx were widened to include 'medusa'; the Integrations registry gained a 3-field Medusa entry (Server URL, Publishable Key, Connection Token).**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-17T15:08:00Z (approx.)
- **Completed:** 2026-07-17T15:19:47Z
- **Tasks:** 2 completed
- **Files modified:** 7 (2 created source + 2 created test + 3 modified source, excluding this SUMMARY)

## Accomplishments
- `supabase/migrations/1259_medusa_integration.sql` created with exactly 10 idempotent `ALTER TYPE ... ADD VALUE IF NOT EXISTS` statements, verbatim per the plan's interfaces block, no transaction wrapper, no row seeds
- All 3 `integration_provider` union occurrences in `database.ts` (Enums definition, `integrations` table `Row`, `integrations` table `Insert`) widened to include `'medusa'`; `action_type` union left untouched (132-04's atomic responsibility)
- `IntegrationForDisplay.provider` union in `src/app/(dashboard)/integrations/actions.ts` widened
- `INTEGRATION_REGISTRY` gained a `medusa` entry (Server URL → `location_id`, Publishable Key → `publishable_key`, Connection Token → `api_key`), cloned from the xkedule template shape
- 21 new unit tests (`tests/medusa-migration.test.ts` — 15, `tests/medusa-registry.test.ts` — 6), all green
- `npm run build` green in the worktree (full production build + type check)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 1259 + widen provider type unions** - `e893843f` (feat)
2. **Task 2: Medusa registry entry** - `ff224cb0` (feat)

_Note: both tasks were `tdd="true"`; per the plan's behavior spec, the test file was created alongside the implementation edits within a single commit rather than as a separate RED commit, matching the plan's "action" step ordering (create test → run build) rather than a strict RED-before-GREEN split._

## Files Created/Modified
- `supabase/migrations/1259_medusa_integration.sql` - 10-statement idempotent enum migration (integration_provider + 9 action_type values)
- `src/types/database.ts` - widened 3 `integration_provider` union occurrences to include `'medusa'`
- `src/app/(dashboard)/integrations/actions.ts` - widened `IntegrationForDisplay.provider` union
- `src/lib/integrations/registry.ts` - added the `medusa` `INTEGRATION_REGISTRY` entry (3 fields)
- `src/components/integrations/integration-form.tsx` - added `medusa: 'Medusa'` to the exhaustive `PROVIDER_LABELS` record (build-blocking fix, see Deviations)
- `tests/medusa-migration.test.ts` - fs+regex assertions on the migration file contents and the widened provider unions
- `tests/medusa-registry.test.ts` - registry entry shape/field assertions

## Decisions Made
- Left `action_type` union in `database.ts` completely untouched, per the plan's explicit CRITICAL instruction — widening it here would break `_executeActionInner`'s exhaustive `never` switch and fail the build; that edit is bundled with the dispatcher switch cases in 132-04.
- Registry category set to `'crm'` (research Open Q2 — no `'commerce'` category exists; adding one is a 3-file change out of scope for this plan).
- `logo: { letter: 'M', color: 'bg-neutral-900' }` used without a `path` — confirmed `IntegrationLogo.path` is optional (`path?: string`), matching the plan's fallback guidance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed exhaustive `PROVIDER_LABELS` Record missing 'medusa' key**
- **Found during:** Task 1 (`npm run build` after widening the `Provider` union)
- **Issue:** `src/components/integrations/integration-form.tsx` defines `const PROVIDER_LABELS: Record<Provider, string> = {...}` — an exhaustive object keyed by every provider. Widening `IntegrationForDisplay.provider` (the source of `Provider`) to include `'medusa'` made this Record fail to type-check (`Property 'medusa' is missing`), blocking `npm run build`. This file was not listed in the plan's `files_modified`, but the failure is a direct, unavoidable consequence of the plan's required type-union edit.
- **Fix:** Added `medusa: 'Medusa',` to the record, matching the existing label pattern (e.g. `xkedule: 'Xkedule'`).
- **Files modified:** `src/components/integrations/integration-form.tsx`
- **Verification:** `npm run build` succeeds (full production build + type check)
- **Committed in:** `e893843f` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy the plan's own explicit "build green" acceptance criterion; no scope creep beyond a one-line label addition following the established pattern.

## Issues Encountered

- The plan's Task 1 acceptance criteria states `grep -c "medusa_" supabase/migrations/1259_medusa_integration.sql -> 9`, but the actual count is 10. This is because the migration's own verbatim comment line ("Adds 'medusa' to integration_provider and all nine medusa_* action types.") also contains the substring `medusa_` and `grep -c` counts matching *lines*, not occurrences. The migration file content is copied exactly verbatim from the plan's `<interfaces>` block (which mandated "copy verbatim"), so no correction was made to the file — this is a minor off-by-one in the plan's stated acceptance-criteria expectation, not a defect in the deliverable. The plan's own `tests/medusa-migration.test.ts` behavior spec (which this plan's test file implements) checks presence of each of the 9 action-type strings individually via `.toContain()`, not a line-count grep, and all 9 pass correctly.

## User Setup Required

None - no external service configuration required. (Registry entry appears in the UI once an org saves credentials — a manual/E2E round-trip is documented in `132-VALIDATION` as out of automated scope for this plan.)

## Next Phase Readiness

- MED-01 (schema) and MED-02 (registry) are both complete: the enum values exist in `database.ts`'s type surface, and the Integrations UI can render/save a Medusa connection (Server URL, Publishable Key, Connection Token → `config.publishable_key` via the existing `saveIntegrationCredentials` spread, verified unchanged).
- `npm run build` is green in this worktree, confirming no `action_type` premature-widening occurred and the exhaustive dispatcher switch in `execute-action.ts` is untouched — 132-04 can safely add the 9 `medusa_*` action_type union values + switch cases as one atomic unit.
- No blockers for 132-02/132-03 (parallel Wave 1 plans) or 132-04 (Wave 2, depends on this plan's migration + type unions).
- Sibling agents (132-02, 132-03) should not touch `src/types/database.ts`'s `integration_provider`/`provider` union lines or `src/app/(dashboard)/integrations/actions.ts`'s `IntegrationForDisplay.provider` line — those are now widened and any conflicting edit would need to merge cleanly against this commit.

---
*Phase: 132-medusa-provider-read-tools*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: supabase/migrations/1259_medusa_integration.sql
- FOUND: tests/medusa-migration.test.ts
- FOUND: tests/medusa-registry.test.ts
- FOUND: commit e893843f (Task 1)
- FOUND: commit ff224cb0 (Task 2)

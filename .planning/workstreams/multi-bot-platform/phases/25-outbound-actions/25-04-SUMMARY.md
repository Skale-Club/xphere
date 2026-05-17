---
phase: 25-outbound-actions
plan: "04"
subsystem: ui
tags: [manychat, typescript, zod, forms, type-safety]

# Dependency graph
requires:
  - phase: 25-outbound-actions
    provides: 4 ManyChat executor files, migration 028 with action_type enum extension, action engine wiring, 78 passing unit tests

provides:
  - ManyChat action types selectable via tool_config UI form (z.enum + ACTION_TYPE_OPTIONS)
  - tool_configs.Update.action_type widened to 10-value union (matches Row and Insert)
  - tools/actions.ts as-casts use Database['public']['Enums']['action_type'] canonical type
  - ToolConfigWithIntegration.action_type uses canonical Enums type
  - dispatch-event.test.ts stale @ts-expect-error Wave 0 suppression removed
  - npm run build exits 0 with full TypeScript pass

affects: [26-outbound-actions-tests, 27-google-contacts, tools-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Use Database['public']['Enums']['action_type'] for as-casts instead of hardcoded union literals"
    - "z.enum in tool forms must be kept in sync with database.ts Enums and Row/Insert/Update types"

key-files:
  created: []
  modified:
    - src/components/tools/tool-config-form.tsx
    - src/types/database.ts
    - src/app/(dashboard)/tools/actions.ts
    - tests/manychat/dispatch-event.test.ts

key-decisions:
  - "Replace hardcoded 6-value union as-casts with Database['public']['Enums']['action_type'] canonical type to avoid future staleness"
  - "Widen ToolConfigWithIntegration.action_type (deviation Rule 2) so the exported type is correct end-to-end, not just at the DB insert boundary"

patterns-established:
  - "New action_type values require 4 coordinated updates: DB migration, database.ts (Row+Insert+Update+Enums), tool-config-form.tsx (z.enum+OPTIONS), and tools/actions.ts (as-cast)"

requirements-completed: [OUTBOUND-01, OUTBOUND-02, OUTBOUND-03, OUTBOUND-04]

# Metrics
duration: 15min
completed: 2026-05-07
---

# Phase 25 Plan 04: Gap Closure — ManyChat UI and Type Safety Summary

**4 ManyChat action types now selectable via tool_config UI form; database.ts Update type widened to 10-value union; as-casts use canonical Enums type; stale @ts-expect-error removed; build and 78 tests pass**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-07T08:32:00Z
- **Completed:** 2026-05-07T08:47:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- ManyChat action types (manychat_set_field, manychat_add_tag, manychat_trigger_flow, manychat_send_message) are now selectable via the normal tool_config UI form — both the Zod schema and the select options list include all 10 values
- database.ts tool_configs.Update.action_type widened to the full 10-value union, matching Row and Insert; no more type divergence between shape variants
- tools/actions.ts as-casts replaced with Database['public']['Enums']['action_type']; ToolConfigWithIntegration.action_type also uses the canonical type
- Stale Wave 0 @ts-expect-error directive removed from dispatch-event.test.ts
- npm run build exits 0; all 78 ManyChat unit tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Widen z.enum and ACTION_TYPE_OPTIONS in tool-config-form.tsx** - `43c9fb5` (feat)
2. **Task 2: Widen Update type in database.ts and remove narrow as-casts in tools/actions.ts** - `86004cb` (fix)
3. **Task 3: Remove stale @ts-expect-error in dispatch-event.test.ts and verify build** - `240675e` (fix)

## Files Created/Modified

- `src/components/tools/tool-config-form.tsx` - Added 4 ManyChat values to z.enum and ACTION_TYPE_OPTIONS
- `src/types/database.ts` - Widened tool_configs.Update.action_type from 6-value to 10-value union
- `src/app/(dashboard)/tools/actions.ts` - Added Database import; replaced narrow as-casts; widened ToolConfigWithIntegration.action_type
- `tests/manychat/dispatch-event.test.ts` - Removed stale @ts-expect-error Wave 0 suppression

## Decisions Made

- Used `Database['public']['Enums']['action_type']` as the canonical as-cast type instead of inlining the 10-value union literal, so future enum additions only need to be made in database.ts — not in actions.ts as well.
- Widened `ToolConfigWithIntegration.action_type` (deviation Rule 2) even though not explicitly in the task spec, because leaving it as a 6-value union while the DB and as-casts use 10 values would have caused a TypeScript type mismatch in callers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Widened ToolConfigWithIntegration.action_type**
- **Found during:** Task 2 (database.ts and actions.ts edits)
- **Issue:** Plan specified fixing the as-casts on lines 144 and 182, but ToolConfigWithIntegration.action_type on line 11 still had the old 6-value union. With the as-casts now referencing the canonical Enums type, the exported ToolConfigWithIntegration type would be inconsistent.
- **Fix:** Changed `action_type` field to `Database['public']['Enums']['action_type']` in the ToolConfigWithIntegration interface
- **Files modified:** src/app/(dashboard)/tools/actions.ts
- **Verification:** Build passes cleanly; TypeScript saw no errors
- **Committed in:** 86004cb (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical type consistency)
**Impact on plan:** Necessary type correctness fix within the same file. No scope creep.

## Issues Encountered

None - all edits applied cleanly, build passed on first attempt.

## Known Stubs

None - all 4 action types are fully wired end-to-end (executor files, action engine, UI form, database types).

## Next Phase Readiness

- Phase 25 gap closure complete — operators can now create and edit tool_configs with ManyChat action types via the standard UI form
- Human UAT for live ManyChat execution (OUTBOUND-01 through OUTBOUND-04) remains per 25-HUMAN-UAT.md; those require live credentials and cannot be automated
- Ready for Phase 26 (outbound actions tests) or Phase 27 (Google Contacts Integration)

---
*Phase: 25-outbound-actions*
*Completed: 2026-05-07*

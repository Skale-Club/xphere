---
phase: 119-block-palette-drag-and-drop
plan: 01
subsystem: ui
tags: [email-editor, dnd-kit, drag-and-drop, immutable, vitest, pure-functions]

# Dependency graph
requires:
  - phase: 118-block-stable-ids
    provides: "Every EmailBlock carries a stable `id` (via normalizeDocument backfill) — required to locate/move blocks by id"
provides:
  - "src/lib/email/editor-dnd.ts — three pure, immutable document-mutation helpers: findBlockLocation, insertBlockInColumn, moveBlock"
  - "tests/email-editor-dnd.test.ts — 10 tests pinning insert-at-index/clamp, within-column reorder, cross-column move, findBlockLocation hit+miss, immutability"
affects: [119-02-palette-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure document-mutation helpers decoupled from dnd-kit + DOM — drag OUTCOMES tested without a real pointer"
    - "Immutable update: helpers return a NEW EmailDocument, sharing untouched sub-arrays by reference; only the touched column is rebuilt"

key-files:
  created:
    - src/lib/email/editor-dnd.ts
    - tests/email-editor-dnd.test.ts
  modified: []

key-decisions:
  - "moveBlock is remove-then-insert; toIndex is against the POST-removal array — the 119-01 tests are the contract (119-02 must not change the helper to satisfy the editor)"
  - "insertBlockInColumn clamps index to [0, col.length] and returns doc unchanged (===) for a bad section/column, never throws"
  - "Helpers are dependency-free (only a type import from render-template) — no runtime coupling to dnd-kit"

patterns-established:
  - "Pattern: pure-helper-first for DnD — all block insert/move/reorder logic lives in tested functions; the editor's onDragEnd becomes a thin wiring layer"

requirements-completed: []  # UFE-08 spans 119-01 + 119-02; marked complete after 119-02 lands the UI wiring

# Metrics
duration: 2min
completed: 2026-07-02
---

# Phase 119 Plan 01: Pure Block DnD Helpers Summary

**Three pure, immutable `EmailDocument` helpers (findBlockLocation / insertBlockInColumn / moveBlock) that encode all block insert/move/reorder logic, unit-tested (10/10) to prove drag outcomes without a real pointer.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-07-02T17:24:30Z
- **Completed:** 2026-07-02T17:26:33Z
- **Tasks:** 2
- **Files modified:** 2 (created)

## Accomplishments
- `src/lib/email/editor-dnd.ts` exports exactly three pure helpers; zero `any`; only a type import from `./render-template`.
- `insertBlockInColumn` inserts at an exact clamped index (shifts the rest right) and returns the same doc reference for an unknown section/column.
- `moveBlock` handles within-column reorder AND cross-column move via remove-then-insert; source shrinks by 1, target grows by 1, block id preserved.
- `findBlockLocation` returns `{sectionId, colIdx, index}` for a known id and `null` for an unknown id.
- All helpers are immutable — verified by tests asserting the input document's id-arrays are untouched after each call.
- `tests/email-editor-dnd.test.ts` — 10/10 green; asserts exact id-array outcomes (not just lengths) so a splice/clamp regression fails loudly.

## Task Commits

Each task was committed atomically (TDD: implementation then tests; helpers passed on first test run — no separate RED failing commit needed since the helper spec was fully provided):

1. **Task 1: Write the three pure DnD helpers in editor-dnd.ts** - `ed87d4e4` (feat)
2. **Task 2: Write tests/email-editor-dnd.test.ts** - `6fb7da0c` (test)

**Plan metadata:** committed with the phase-level docs commit.

## Files Created/Modified
- `src/lib/email/editor-dnd.ts` - Pure DnD document helpers: findBlockLocation, insertBlockInColumn, moveBlock (immutable, dependency-free).
- `tests/email-editor-dnd.test.ts` - 10 unit tests covering index insert + clamp, within/cross-column move, findBlockLocation hit+miss, immutability.

## Decisions Made
- None beyond the plan — the helper implementation and test bodies were specified verbatim in 119-01-PLAN.md and used as-is.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None. Type-check reported no errors in editor-dnd; all 10 tests passed on the first run.

## User Setup Required
None - no external service configuration required. Pure client-side code, no DB/migration.

## Next Phase Readiness
- Helpers + contract tests are the stable foundation 119-02 wires into the single `DndContext`.
- Reminder (carried from 118): migrations 1225/1226/1227/1228 remain unapplied — irrelevant to this pure-code plan, but live pointer-drag verification of 119-02 is deferred until they apply.

## Self-Check: PASSED

- FOUND: src/lib/email/editor-dnd.ts
- FOUND: tests/email-editor-dnd.test.ts
- FOUND: 119-01-SUMMARY.md
- FOUND commit: ed87d4e4 (Task 1 feat)
- FOUND commit: 6fb7da0c (Task 2 test)

---
*Phase: 119-block-palette-drag-and-drop*
*Completed: 2026-07-02*

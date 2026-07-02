---
phase: 118-stable-block-ids-normalization
plan: 02
subsystem: email-templates
tags: [email, editor, block-ids, react-keys, refactor]
requires:
  - "makeBlockId + normalizeDocument + EmailBlock.id from Plan 118-01"
provides:
  - "id-based block selection (selectedBlockId) in the editor"
  - "id-keyed block lists (key={block.id})"
  - "fresh id minted per new block; reusable-insert re-mints ids"
  - "editor consumes the shared normalizeDocument (local no-op deleted)"
affects:
  - "Phase 119 (block drag-and-drop) — stable id keys are its prerequisite"
tech-stack:
  added: []
  patterns:
    - "Stable id keys instead of array-index keys (survives reorder/insert)"
    - "Positional section+column addressing retained; only BLOCK identity moved to id"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/email-templates/_components/email-template-editor.tsx
    - src/lib/email/render-template.ts
decisions:
  - "selectedBlockPath {sectionId,colIdx,blockIdx} → selectedBlockId: string|null; blocks located by id, sections/columns still addressed positionally."
  - "insertReusableBlock re-mints ids via source.map((b) => ({...b, id: makeBlockId()})) so inserting the same saved block twice never collides."
  - "Removed the now-unused colIdx/layout/sectionId from the ColumnEditor destructure (props retained on the interface for a future DnD phase) to keep the build lint-clean."
metrics:
  duration: ~5m
  tasks: 3
  files-changed: 2
  completed: 2026-07-02
---

# Phase 118 Plan 02: Editor id-based Refactor Summary

The email-template editor now addresses blocks by stable `id` instead of array index: selection is `selectedBlockId`, add/remove/update locate blocks by id, block lists render `key={block.id}`, new blocks mint a fresh `makeBlockId()`, and inserting a reusable block re-mints ids. Zero user-visible change — pure plumbing that unblocks Phase 119 drag-and-drop.

## What Was Built

- **Imports:** editor now pulls `makeBlockId` + `normalizeDocument` from `@/lib/email/render-template`; the local no-op `normalizeDocument` (and the now-unused `emptyDocument` import) were deleted.
- **Selection state:** `selectedBlockPath { sectionId, colIdx, blockIdx }` → `selectedBlockId: string | null`.
- **`addBlock`:** mints `{ ...BLOCK_DEFAULTS[type], id: makeBlockId() }`, appends to the target column, and `setSelectedBlockId(block.id)`. Dropped the stale `doc.sections` dependency.
- **`insertReusableBlock`:** `source.map((b) => ({ ...b, id: makeBlockId() }))` re-mints every inserted block so double-insert of the same reusable block yields distinct ids.
- **`removeBlock` / `updateBlock`:** signatures take `blockId: string`; filter/map the column by `b.id`.
- **`selectedBlock` derivation:** finds by id across the whole doc (`flatMap(...).find(b => b.id === selectedBlockId)`).
- **Component tree:** `SortableSection` and `ColumnEditor` props/handlers use `blockId: string` and `selectedBlockId: string | null`; `ColumnEditor` renders `key={block.id}` with `isSelected={selectedBlockId === block.id}`. `BlockEditor` was already index-free — untouched.

## Verification

- `npm run build` — exit 0 (Compiled successfully; TypeScript check passed).
- `npx vitest run tests/email-block-ids.test.ts` — 8/8 passed (HTML byte-identical guarantee intact).
- `npx vitest run tests/email-template-builder.test.ts` — 17/17 passed (no regression; fixture literals without `id` flow only through `renderTemplate`).
- Grep sweep: `blockIdx` and `selectedBlockPath` appear ZERO times in the editor; `key={block.id}`, `selectedBlockId`, `makeBlockId()`, and the shared `normalizeDocument` import are all present.
- No DB migration added; `npx supabase db push` not run (ids persist via the existing `saveTemplate` action on next save).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `Omit<EmailBlock,'id'>` collapsed the discriminated union**
- **Found during:** Task 3 (`npm run build`)
- **Issue:** `BLOCK_DEFAULTS: Record<string, Omit<EmailBlock, 'id'>>` (as specified in Plan 118-01) failed the type check — plain `Omit` over a discriminated union keeps only shared keys, dropping `content`/`fontSize`/etc.
- **Fix:** Introduced an exported `DistributiveOmit<T, K>` helper in `render-template.ts` and typed `BLOCK_DEFAULTS` with it so the omit distributes per union member. Semantics unchanged.
- **Files modified:** `src/lib/email/render-template.ts`
- **Commit:** `54ee7fd7`
- (Also documented in 118-01-SUMMARY since it touched that plan's type layer.)

**2. [Rule 3 - Blocking] Unused destructured props in `ColumnEditor`**
- **Found during:** Task 2
- **Issue:** After moving block identity to `id`, `colIdx`/`layout`/`sectionId` were no longer read in the `ColumnEditor` body (they had only fed the old index-based `isSelected` comparison), which would produce lint noise.
- **Fix:** Removed them from the destructure while keeping them on `ColumnEditorProps` (parent still passes them; a future DnD phase may re-consume column/section addressing).
- **Files modified:** `src/app/(dashboard)/email-templates/_components/email-template-editor.tsx`
- **Commit:** `efb5ff22`

## Known Stubs

None. No hardcoded empty/placeholder data introduced; the refactor is behavior-preserving plumbing.

## Commits

- `54ee7fd7` — fix(118-02): distributive Omit for BLOCK_DEFAULTS id-free typing
- `efb5ff22` — refactor(118-02): id-based block addressing in email-template editor

## Self-Check: PASSED

All modified/created files exist on disk; both commits (54ee7fd7, efb5ff22) are present in git history.

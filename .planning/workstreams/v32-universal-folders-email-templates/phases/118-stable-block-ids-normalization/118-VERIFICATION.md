---
status: passed
phase: 118-stable-block-ids-normalization
verified: 2026-07-02
mode: pure-code — TEST-VERIFIED (no DB dependency)
---

# Phase 118 Verification — Stable Block IDs + Normalization

**Result: PASSED — genuinely test-verified** (this phase has no DB dependency, so verification is real, not deferred).

## Success Criteria
1. **Every block type carries `id`; block creation mints ids** — ✅ `BaseBlock = { id: string }` in all seven block types; `makeBlockId()` (reuses existing algorithm, no new dep); `addBlock`/`insertReusableBlock` mint/re-mint ids.
2. **normalizeDocument backfills ids for legacy docs on read; opening an old template renders identically** — ✅ `normalizeDocument` moved to + exported from `render-template.ts`, idempotent id backfill. Test: **renderTemplate HTML byte-identical before vs after backfill** (ids never emitted).
3. **Editor selection/updates key by id, not index** — ✅ `selectedBlockId`; id-based add/remove/update/insert; `key={block.id}`. Grep: `blockIdx`/`selectedBlockPath` = 0 in editor.
4. **npm run build passes; existing template round-trips unchanged** — ✅ build exit 0; `tests/email-block-ids.test.ts` 8/8; `tests/email-template-builder.test.ts` 17/17 (no regression).

## Requirements
- UFE-07 ✅ — complete and test-verified.

## Notes
- Real bug caught + fixed: `Omit<EmailBlock,'id'>` collapsed the discriminated union → introduced `DistributiveOmit`. No deferred items — this phase needs no migration.

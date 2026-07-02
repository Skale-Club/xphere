---
phase: 118-stable-block-ids-normalization
plan: 01
subsystem: email-templates
tags: [email, render-template, block-ids, normalization, upgrade-on-read]
requires:
  - "renderTemplate + EmailDocument/EmailBlock types (existing render-template.ts)"
provides:
  - "BaseBlock { id } on all seven block types"
  - "makeBlockId() exported from render-template.ts"
  - "normalizeDocument() exported with id backfill (upgrade-on-read)"
  - "BLOCK_DEFAULTS typed Omit<EmailBlock,'id'>"
affects:
  - "Plan 118-02 (editor imports makeBlockId + normalizeDocument)"
tech-stack:
  added: []
  patterns:
    - "Upgrade-on-read normalization: backfill missing ids in memory, persist on next save (no DB migration)"
    - "Editor-only metadata that is never emitted into rendered HTML"
key-files:
  created:
    - tests/email-block-ids.test.ts
  modified:
    - src/lib/email/render-template.ts
decisions:
  - "Reuse the existing Math.random().toString(36).slice(2,10) generator for makeBlockId() — no new dependency (no nanoid/uuid)."
  - "BLOCK_DEFAULTS retyped Omit<EmailBlock,'id'> so the static defaults stay id-free; a fresh id is minted at block-creation time (editor, Plan 118-02)."
  - "normalizeDocument lives in render-template.ts (a plain non-'use client' module) so it is importable by the Vitest node runner and by the editor."
metrics:
  duration: ~2m
  tasks: 3
  files-changed: 2
  completed: 2026-07-02
---

# Phase 118 Plan 01: Stable Block IDs + Normalization (data layer) Summary

Every email block type now carries a stable `id: string` (via a shared `BaseBlock`), and legacy documents self-heal on read through an exported `normalizeDocument()` that backfills missing block/section ids in memory — all without a DB migration and with byte-identical rendered HTML (ids are editor-only metadata, never emitted).

## What Was Built

- **`BaseBlock = { id: string }`** mixed via `BaseBlock &` into all seven block types (Text, Heading, Image, Button, Divider, Spacer, Html). The `EmailBlock` union still discriminates on `blockType` and now inherits `id` from every member.
- **`makeBlockId()`** — exported; reuses the editor's exact `Math.random().toString(36).slice(2, 10)` algorithm. No new dependency.
- **`normalizeDocument(raw)`** — moved out of the client editor into `render-template.ts` and exported. Validates document shape, backfills a fresh id on any block/section missing one (`x.id || makeBlockId()`), is idempotent, does not mutate input, and falls back to `emptyDocument()` on non-document input.
- **`BLOCK_DEFAULTS`** retyped `Record<string, Omit<EmailBlock, 'id'>>` (value unchanged) so the shared static defaults carry no id; the editor mints one per block at creation (Plan 118-02).
- **`tests/email-block-ids.test.ts`** — 8 tests, all green.

## Verification

- `npx vitest run tests/email-block-ids.test.ts` — 8/8 passed, including:
  - backfill yields unique, non-empty ids on a legacy doc
  - idempotency (existing ids preserved on second normalize)
  - empty-document fallback for null/array/malformed input
  - no-mutation of input
  - **`renderTemplate` HTML is byte-identical before vs after normalization**
  - ids never appear in the rendered HTML
  - re-minting a saved block set twice yields disjoint id sets
- Grep confirmed no `render*` function references `block.id` — the only `.id` reads are the two backfill lines inside `normalizeDocument`.

Note: full `npm run build` is deferred to Plan 118-02 per the plan — the existing `tests/email-template-builder.test.ts` fixture literals lack `id`, which is expected until the editor refactor lands (they flow only through `renderTemplate`, which ignores id). This module is internally type-consistent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `Omit<EmailBlock,'id'>` collapsed the discriminated union**
- **Found during:** Plan 118-02 Task 3 (`npm run build`)
- **Issue:** The plan specified `BLOCK_DEFAULTS: Record<string, Omit<EmailBlock, 'id'>>`. Plain `Omit` on a discriminated union computes only the union's *shared* keys, so `Omit<EmailBlock, 'id'>` reduced every default to just `{ blockType }` and dropped per-block properties — the build failed with `'content' does not exist in type 'Omit<EmailBlock, "id">'`.
- **Fix:** Added an exported `DistributiveOmit<T, K>` helper (`T extends unknown ? Omit<T, K> : never`) and typed `BLOCK_DEFAULTS` as `Record<string, DistributiveOmit<EmailBlock, 'id'>>`. The omit now distributes over each union member, preserving its own keys. Semantics unchanged (still id-free defaults).
- **Files modified:** `src/lib/email/render-template.ts`
- **Commit:** `54ee7fd7`

## Commits

- `8658bc54` — feat(118-01): add stable block ids + exported normalizeDocument to render-template
- `5b408377` — test(118-01): add tests/email-block-ids.test.ts

## Self-Check: PASSED

All modified/created files exist on disk; both commits (8658bc54, 5b408377) are present in git history.

# Phase 118: Stable Block IDs + Normalization - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** PURE CODE — no DB, no migration. Fully verifiable via `npm run build` + a unit test. (Prereq for Phase 119 drag-and-drop.)

<domain>
## Phase Boundary
Give every email block a STABLE `id` so the editor can key + drag blocks by identity instead of array index — WITHOUT breaking any saved template. Legacy documents (blocks with no id) get ids backfilled on read (`normalizeDocument`), persisted on next save. The rendered HTML output must be byte-identical (ids are editor-only metadata, never emitted). No visual/behavior change for the user in this phase.
</domain>

<decisions>
## Implementation Decisions

### Types — `src/lib/email/render-template.ts`
- Add `id: string` to every block type (TextBlock, HeadingBlock, ImageBlock, ButtonBlock, DividerBlock, SpacerBlock, HtmlBlock). Cleanest: define `type BaseBlock = { id: string }` and make each block type include it (or `EmailBlock = BaseBlock & (…union…)`). Keep `blockType` as the discriminant.
- Sections already have a stable `id` — mirror that convention. Reuse the existing id generator (the helper that makes section ids — find `makeId`/`crypto.randomUUID`/nanoid usage) for a `makeBlockId()`; do not add a new dependency.

### Block creation mints a fresh id
- `BLOCK_DEFAULTS` are static objects → block creation must spread + assign a NEW id: `{ ...BLOCK_DEFAULTS[type], id: makeBlockId() }`. Find every place a block is instantiated (editor `addBlock`) and ensure a fresh id is minted.

### `normalizeDocument` backfills ids (upgrade-on-read)
- Find `normalizeDocument` (called by `EmailTemplateEditor` on `template.document`; likely in the editor file or render-template.ts). Extend it so that for EVERY block in every section/column, if `block.id` is missing/empty, assign `makeBlockId()`. This makes old templates gain ids in memory; they persist on the next save (no DB migration needed). Do the same for section ids if any are missing (defensive).

### Editor refactor — `src/app/(dashboard)/email-templates/_components/email-template-editor.tsx`
- Replace the index-path selection `selectedBlockPath { sectionId, colIdx, blockIdx }` with `selectedBlockId: string | null`.
- Rework `addBlock` / `removeBlock` / `updateBlock` / `insertReusableBlock` to locate the target block by `id` within its column (find by id rather than by blockIdx). Keep the section+column addressing for INSERT position, but identify existing blocks by id.
- Render lists keyed by `block.id` (replace `key={blockIdx}`).
- **Reusable-block insert:** reusable blocks carry ids from when they were saved; on insert, RE-MINT ids (`blocks.map(b => ({ ...b, id: makeBlockId() }))`) so inserting the same reusable block twice never yields duplicate ids.

### Renderer unchanged
- `renderTemplate` must NOT emit `id` into the HTML. Verify the HTML output is identical before/after adding ids.

### Verification (achievable — this phase is pure code)
- `npm run build` exit 0.
- Add `tests/email-block-ids.test.ts` (Vitest): (1) `normalizeDocument` on a legacy doc (blocks without id) yields blocks all having non-empty unique ids; (2) `renderTemplate(doc)` HTML is unchanged after normalization (ids are not rendered); (3) inserting a reusable block twice yields distinct ids.
</decisions>

<code_context>
## Existing Code Insights (from prior deep read of the editor)
- `src/lib/email/render-template.ts` — block type union (~lines 33-91), `BLOCK_DEFAULTS` (~lines 328-369), `renderTemplate`. Blocks currently have NO `id`.
- `src/app/(dashboard)/email-templates/_components/email-template-editor.tsx` (~800 lines) — holds `useState<EmailDocument>(normalizeDocument(template.document))`; `selectedBlockPath` state; `addBlock`/`removeBlock`/`updateBlock`/`insertReusableBlock` operate by `{sectionId, colIdx, blockIdx}`; ColumnEditor renders blocks with `key={blockIdx}`. Sections use a stable `id` already (pattern to copy for blocks).
- `EmailSection` has `id`; `columns: EmailBlock[][]`.
</code_context>

<specifics>
## Specific Ideas
- Zero user-visible change this phase — it's plumbing for 119. Existing templates must open + render identically.
- Do NOT change `renderTemplate`'s output. Do NOT add a DB migration (ids live in the `document` jsonb, backfilled on read, persisted on save).
</specifics>

<deferred>
## Deferred Ideas
- Left palette + drag-and-drop of blocks into/between columns → Phase 119 (depends on these ids).
</deferred>

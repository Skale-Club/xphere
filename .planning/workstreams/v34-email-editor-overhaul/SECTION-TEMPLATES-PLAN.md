# Plan — Section Templates in the Email sidebar (v3.4 follow-up)

**Goal:** Surface "section templates" (the `reusable_email_blocks` — saved multi-block
sections) in the left **EMAIL TEMPLATES** sub-sidebar, organizable in folders like
templates are, instead of only living as chips in the editor palette.

## Current reality (from research)

| Thing | File | State |
|---|---|---|
| Sub-sidebar | `src/components/email-templates/email-template-sub-nav.tsx` + `settings/email-templates/layout.tsx` | Renders templates via generic `DraggableTreeNav` |
| Tree component | `src/components/layout/draggable-tree-nav.tsx` | Generic: items + folders, DnD, rename, delete, reorder |
| Folders | `folders` table, `entity_type ∈ {workflow, project, tool, email_template}` | Universal; scoped per entity_type |
| Templates ↔ folders | `email_templates.folder_id` (migration 1228) | Foldered |
| Section templates | `reusable_email_blocks` (migration 1097) | **Flat — no `folder_id`, no entity_type** |
| Foldering core | `src/lib/foldering/core.ts` + `email-templates/_actions/folders.ts` | Reusable wrapper pattern per entity_type |

**Key gap:** `reusable_email_blocks` has no `folder_id`; `'reusable_email_block'` is
not an allowed `folders.entity_type`.

## Design decision

Section templates get their **own tab** in the sub-nav (**Templates | Sections**), each
tab a `DraggableTreeNav` bound to its own `entity_type` folder tree. Folders are already
entity-scoped, so Sections get an independent folder tree — no awkward shared tree.
Reuses the universal folders system and `DraggableTreeNav` wholesale.

## Phases

### Phase 1 — Schema + foldering backend  *(small, low risk)*
- Migration `1235_reusable_block_folders.sql`:
  - `alter table reusable_email_blocks add column folder_id uuid references folders(id) on delete set null, add column position int not null default 0;`
  - extend `folders_entity_type_check` to include `'reusable_email_block'`.
  - index on `(folder_id)`.
- Apply to prod `mwklvkmggmsintqcqfvu` via MCP (additive).
- Regenerate/extend `src/types/database.ts` for the new columns.
- New actions wrapper `email-templates/_actions/reusable-block-folders.ts`
  (entity_type=`reusable_email_block`, itemTable=`reusable_email_blocks`) mirroring
  `folders.ts`: create/rename/delete/move/reorder folders + move block to folder.
- Extend `getReusableBlocks()` to return `folder_id, position`; add `renameReusableBlock`.

### Phase 2 — Sub-nav tab + organize existing  *(the visible feature)*
- Add a **Templates | Sections** tab toggle atop `EmailTemplateSubNav`.
- Sections tab renders `DraggableTreeNav` over reusable blocks + their folders:
  rename, delete, drag-to-folder, reorder, new folder.
- `settings/email-templates/layout.tsx` fetches reusable blocks + their folders too.
- Clicking a section template → preview panel (renders its blocks) with an
  **"Insert into open template"** action when an editor is open.
- Creation stays via the editor's existing **"Save as reusable"** (enhanced to pick a
  target folder). "+ Section" in the sidebar opens that same save dialog scoped to the
  active folder, OR is hidden in v1 (decision below).

### Phase 3 — Standalone section-template editor  *(optional, larger)*
- Clicking a section template opens a dedicated **fragment editor** (the block editor in
  single-section mode) to edit it directly; "+ New section template" creates from scratch.
- Requires a fragment mode for `EmailTemplateEditor` (document = `{ blocks }`, no sections
  chrome) + a route `settings/email-templates/sections/[id]`.

## Open decisions (need a call before building)
1. **Scope:** stop at Phase 2 (organize existing, create via "Save as reusable"), or go
   to Phase 3 (full standalone section-template editor)?
2. **Deploy cadence:** ship the current polish (points 1 & 2) now, or bundle with this?

## Constraints
- New migration only (`1235_*`); apply via MCP (history desynced — see
  `project_supabase_migration_desync`).
- `DraggableTreeNav` is generic — no changes to it should be needed.

# Roadmap: Xphere v3.2 Universal Foldering + Email Templates

## Overview

This milestone extracts the folder/tree organization system (today duplicated as `workflow_folders`, `project_folders`, `tool_folders`) into a single universal `folders` subsystem reused by every module, and overhauls the Email Templates builder: a Workflows-style sub-sidebar with folders, a left-hand palette with drag-and-drop block editing, an exposed publish lifecycle, and real sending via a `send_email_template` workflow tool and email campaigns. Runs as a parallel workstream and does not disturb the main track's queued v3.1.

## Phases

- [ ] **Phase 114: Universal Folders Backend** - Single `folders` table + shared foldering core; no consumer migrated yet.
- [ ] **Phase 115: Migrate Workflows to Universal Folders** - UUID-preserving data migration; retire `workflow_folders`; UX parity. (HIGH RISK — production data)
- [ ] **Phase 116: Migrate Projects + Tools to Universal Folders** - Migrate `project_spaces` and `tool_folders`; retire legacy tables.
- [ ] **Phase 117: Email Templates Sub-Sidebar + Folders** - Add `folder_id`/`position` to `email_templates`; new layout + `EmailTemplateSubNav` reusing `DraggableTreeNav`. (Greenfield)
- [ ] **Phase 118: Stable Block IDs + Normalization** - Add stable `id` to every block; upgrade-on-read for legacy documents. (Prereq for DnD)
- [ ] **Phase 119: Block Palette + Drag-and-Drop** - Left palette; multi-container dnd-kit for blocks into/between columns.
- [ ] **Phase 120: Publish Lifecycle** - Expose draft/published; reconcile status vocabulary.
- [ ] **Phase 121: Sending Integration** - Merge-tags + `send_email_template` tool (spec/validator) + template selection in campaigns.

## Phase Details

### Phase 114: Universal Folders Backend
**Goal**: Stand up one shared, org-scoped, entity-typed folder store and a reusable foldering module, without switching any existing consumer.
**Depends on**: Nothing
**Requirements**: UFE-01, UFE-02
**Success Criteria**:
1. A `folders` table exists with `entity_type`, self-referential `parent_id`, `position`, color/icon, org-scoped RLS, `moddatetime` trigger, and a `UNIQUE(org_id, entity_type, parent_id, name)` constraint.
2. `src/lib/foldering/core.ts` exposes list/create/rename/updateMeta/reorderFolders/moveFolder/archive/delete plus moveItemToFolder/reorderItemsInFolder, parameterized by `entityType` + item table.
3. `src/types/database.ts` includes the new table and `npm run build` passes.
4. No existing module's folder behavior is changed (workflows/projects/tools still on their current tables).
**Plans:** 1/2 plans executed
- [x] 114-01-PLAN.md — Additive `folders` migration (1225) + `database.ts` types (UFE-01)
- [ ] 114-02-PLAN.md — `src/lib/foldering/core.ts` shared core + smoke test (UFE-02)

### Phase 115: Migrate Workflows to Universal Folders
**Goal**: Move Workflows onto the universal folder store with zero loss of production folders and identical behavior.
**Depends on**: Phase 114
**Requirements**: UFE-03
**Success Criteria**:
1. A data migration copies `workflow_folders` into `folders` (entity_type='workflow') preserving UUIDs, and repoints `workflows.folder_id` to `folders(id)`.
2. Every pre-existing workflow folder and its contents appear unchanged in the sidebar after migration.
3. Create/rename/color/icon/nest/move/reorder/archive/delete/trash all work via the shared foldering core.
4. `workflow_folders` is retired (renamed `_deprecated`) and the app references only `folders`.
5. `npm run build` passes.

### Phase 116: Migrate Projects + Tools to Universal Folders
**Goal**: Move Projects (spaces) and Tools onto the universal folder store, retiring their legacy tables.
**Depends on**: Phase 114
**Requirements**: UFE-04, UFE-05
**Success Criteria**:
1. Data migrations copy `project_spaces` (renamed from `project_folders` in migration 1157) and `tool_folders` into `folders` (entity_type='project'/'tool') preserving UUIDs and FKs.
2. Existing project spaces and tool folders appear unchanged post-migration.
3. Both modules' sidebars operate through the shared foldering core.
4. `project_spaces` and `tool_folders` are retired; `workflow_folders_deprecated` is safe to drop.
5. `npm run build` passes.

### Phase 117: Email Templates Sub-Sidebar + Folders
**Goal**: Give Email Templates a Workflows-style sub-sidebar with universal folders and drag-and-drop organization.
**Depends on**: Phase 114
**Requirements**: UFE-06
**Success Criteria**:
1. `email_templates` gains `folder_id` (FK → `folders`) and `position`.
2. `/settings/email-templates` renders inside `SubSidebarLayout` with an `EmailTemplateSubNav` built on `DraggableTreeNav` (entity_type='email_template').
3. User can create/rename/color/icon/nest folders and drag templates between folders and reorder them.
4. The list view is folder-scoped (Unfiled + folders) and `npm run build` passes.

### Phase 118: Stable Block IDs + Normalization
**Goal**: Give every email block a stable identity without breaking any saved template.
**Depends on**: Phase 117
**Requirements**: UFE-07
**Success Criteria**:
1. Every block type in `render-template.ts` carries an `id`; `BLOCK_DEFAULTS`/block creation mint ids.
2. `normalizeDocument()` backfills ids for legacy documents on read; opening an old template renders identically.
3. Editor selection and updates key blocks by `id` instead of array-index path.
4. `npm run build` passes and an existing template round-trips (open → save) with unchanged HTML snapshot.

### Phase 119: Block Palette + Drag-and-Drop
**Goal**: Turn the editor into a three-pane builder with a draggable block palette and cross-column block DnD.
**Depends on**: Phase 118
**Requirements**: UFE-08
**Success Criteria**:
1. A left palette lists the block types (and reusable blocks) as drag sources.
2. Dragging a palette item into a column inserts a new block at the drop position.
3. Blocks can be reordered within a column and moved between columns; section reorder still works.
4. Live preview and saved snapshot reflect the new arrangement; `npm run build` passes.

### Phase 120: Publish Lifecycle
**Goal**: Expose a coherent draft/published lifecycle and fix the status inconsistency.
**Depends on**: Phase 117
**Requirements**: UFE-09
**Success Criteria**:
1. Status vocabulary is reconciled to a single scheme (draft/published[/archived]) across schema defaults, list badges, and save logic.
2. User can publish/unpublish from the editor toolbar and the list card.
3. Publishing refreshes the HTML snapshot; the badge/status is consistent in list and editor.
4. `npm run build` passes.

### Phase 121: Sending Integration
**Goal**: Make templates sendable from workflows and campaigns, with personalization.
**Depends on**: Phase 120
**Requirements**: UFE-10, UFE-11, UFE-12
**Success Criteria**:
1. Template rendering resolves merge-tags (e.g. `{{contact.first_name}}`) from the recipient/contact at send time.
2. A `send_email_template` tool (input `template_id` + recipient + variables) sends via Resend and is registered in the workflow spec/validator, appearing in `/api/workflows/spec` when email is configured.
3. A workflow run sends a chosen template to a test contact with variables filled.
4. An email campaign can select a builder template; `npm run build` passes.

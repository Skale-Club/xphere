# v3.2 Universal Foldering + Email Templates — Requirements

**Defined:** 2026-07-02
**Core Value:** One reusable foldering subsystem across the platform, and an email template builder that is organizable, drag-and-drop editable, and actually sendable.

## Universal Foldering

- [x] **UFE-01**: Any module stores its folders in a single shared `folders` table, scoped per org and per `entity_type`, replacing the per-entity folder tables.
- [x] **UFE-02**: A shared foldering module provides the full folder + item organization contract (list/create/rename/color/icon/reorder/move/archive/delete) parameterized by entity type and item table, with no duplicated backend logic per module.
- [x] **UFE-03**: Workflows use the universal folder system with every existing production folder preserved and drag-and-drop/UX parity with today.
- [x] **UFE-04**: Projects use the universal folder system (spaces) with existing data preserved.
- [x] **UFE-05**: Tools use the universal folder system with existing data preserved.

## Email Organization

- [x] **UFE-06**: User can organize email templates into folders via a sub-sidebar matching the Workflows experience (create/rename/color/icon/nest, drag templates between folders and reorder).

## Email Editor

- [x] **UFE-07**: Every email block carries a stable identity, and existing saved templates keep rendering unchanged after the upgrade.
- [x] **UFE-08**: User can drag blocks from a left-hand palette into columns and reorder or move blocks within and between columns.

## Email Lifecycle

- [ ] **UFE-09**: User can publish and unpublish a template, with a single consistent status shown in both the list and the editor.

## Email Sending

- [ ] **UFE-10**: Template content supports personalization variables (merge-tags) resolved from the recipient/contact at send time.
- [ ] **UFE-11**: A workflow can send a chosen email template to a contact via a registered `send_email_template` tool that appears in the workflow capability spec.
- [ ] **UFE-12**: User can select a builder email template when configuring an email campaign.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Migrating the legacy `email-marketing` section templates to the block builder | Separate legacy system; this milestone integrates the block builder, not a rewrite of email-marketing |
| A/B testing or scheduling of email sends | Sending path first; optimization deferred to a later milestone |
| Blocks draggable across sections (only within/between columns of a section) | Section reorder already exists; cross-section block DnD is a future refinement |

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| UFE-01 | Phase 114 | Complete |
| UFE-02 | Phase 114 | Complete |
| UFE-03 | Phase 115 | Complete |
| UFE-04 | Phase 116 | Complete |
| UFE-05 | Phase 116 | Complete |
| UFE-06 | Phase 117 | Complete |
| UFE-07 | Phase 118 | Complete |
| UFE-08 | Phase 119 | Complete |
| UFE-09 | Phase 120 | Pending |
| UFE-10 | Phase 121 | Pending |
| UFE-11 | Phase 121 | Pending |
| UFE-12 | Phase 121 | Pending |

**Coverage:**
- v3.2 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-02*
*Last updated: 2026-07-02 — UFE-08 completed (Phase 119: PURE CLIENT CODE, no DB/migration. 119-01 added three pure immutable EmailDocument helpers in src/lib/email/editor-dnd.ts (findBlockLocation/insertBlockInColumn/moveBlock) with tests/email-editor-dnd.test.ts 10/10. 119-02 turned the editor into a three-pane builder: new block-palette.tsx (useDraggable block-type + reusable chips), columns as droppable SortableContexts + empty-column useDroppable at a unified col:${sectionId}:${colIdx} id, blocks as grip-scoped useSortable, all wired into the SINGLE existing DndContext (closestCorners + DragOverlay) with onDragStart/Over/End delegating mutation to the 119-01 helpers; palette/reusable inserts re-mint ids; cross-section block move blocked (out of scope); +Block/Insert fallback menus + section reorder preserved. npm run build exit 0; email suites 35/35. Live pointer-drag deferred to post-migration human-verify — the editor route nests under the folder-querying layout (migrations 1225/1226/1227/1228 still unapplied).)*

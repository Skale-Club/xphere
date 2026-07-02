---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: milestone
current_plan: 116-03 (Wave 2)
status: in_progress
stopped_at: Completed Phase 116 Wave 1 (116-01 + 116-02); foldering core gained itemFolderColumn, migration 1227 written as file + logged in PENDING ledger; build green. Wave 2 (116-03 Projects swap, 116-04 Tools swap) pending.
last_updated: "2026-07-02T12:15:00.000Z"
last_activity: 2026-07-02
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 8
  completed_plans: 6
---

# Project State

## Current Position

Phase: 116
Plan: 116-01 + 116-02 complete (Wave 1); 116-03 + 116-04 pending (Wave 2)
Status: Phase 116 Wave 1 complete — foldering core gained backward-compatible `itemFolderColumn`; migration 1227 written (project_spaces + tool_folders → folders, file only) and logged in PENDING ledger; build green. Wave 2 (code swaps) not started.
Last activity: 2026-07-02

## Progress

**Phases Complete:** 2 / 8
**Current Plan:** 116-03 (Wave 2)
**Roadmap:** 114 → 121 (linear; 116 and 117 depend on 114)

## Accumulated Context

### Decisions

- Unify all folder tables (`workflow_folders`, `project_folders`, `tool_folders`) into one `folders` table with an `entity_type` discriminator; migrate all existing modules in this milestone (user decision, 2026-07-02).
- Shared logic in `src/lib/foldering/core.ts`; each module keeps a thin `'use server'` wrapper (Next Server Action semantics).
- (114-02) Foldering core functions take a leading `FolderingContext { supabase, entityType, itemTable }`; every folder query is `.eq('entity_type', ...)`-scoped; item writes target the dynamic `ctx.itemTable` (single narrow `as any` on that builder only). `created_by` resolved via `ctx.supabase.auth.getUser()` inside the core; auth gating stays the wrapper's job.
- Migrations preserve folder UUIDs so existing `folder_id` FKs stay valid — zero loss of production folders.
- Email blocks gain stable `id` via upgrade-on-read (`normalizeDocument`), no destructive data migration.
- UI is already generic (`DraggableTreeNav` + `SubSidebarLayout`); reuse, don't rebuild.
- (115-01) Migration 1226 written as a FILE only (not applied): UUID-preserving copy `workflow_folders` → `folders` (entity_type='workflow'), FK repoint `workflows.folder_id` → `folders(id)`, RENAME legacy table to `_deprecated` (retire, not drop). Reference audit confirmed `workflows.folder_id` is the sole inbound FK.
- (115-02) Workflow folder actions are thin `'use server'` wrappers over `@/lib/foldering/core` bound to `{ entityType: 'workflow', itemTable: 'workflows' }`; export names/signatures/return shapes preserved so `workflow-sub-nav.tsx` is untouched. `layout.tsx` reads `.from('folders').eq('entity_type','workflow')`.
- (116-01) Foldering core gained optional `itemFolderColumn?: string` on `FolderingContext` (default `'folder_id'`); `moveItemToFolder` reads/writes it via `ctx.itemFolderColumn ?? 'folder_id'`. Backward-compatible — Workflows/Tools/Email keep the default; Projects will pass `'space_id'`. `reorderItemsInFolder` untouched (no folder-column reference); `archiveFolder`/`deleteFolder` kept hardcoded (Projects cascades in its own wrapper).
- (116-02) Migration 1227 written as a FILE only (not applied): UUID-preserving copies `project_spaces` → `folders` (entity_type='project', carries color/icon/created_by) and `tool_folders` → `folders` (entity_type='tool', nulls color/icon/created_by — source lacks them); drops both possible project FK names `if exists` then re-adds `projects_space_id_fkey` → `folders(id)`; repoints `tool_configs_folder_id_fkey` → `folders(id)`; renames both legacy tables `_deprecated`. No extra FK repoints (grep confirmed only self-referential parent_id + the two item-column FKs). Tool uniqueness loosens from NULLS-NOT-DISTINCT to NULLS-DISTINCT — accepted.

### Blockers/Concerns

- Phase 115 code is committed but migration 1226 is NOT applied — the swapped layout/actions query `folders`, so migration 1226 MUST be applied (AFTER 1225) before the Phase 115 code deploys, or the Workflows sidebar will show no folders. See PENDING-MIGRATIONS.md.
- Runtime/data parity for Workflows folders (existing folders unchanged + full CRUD) is a deferred human-verify — only checkable after 1226 runs against production.
- Migration `1225_universal_folders.sql` (and now `1226`, `1227`) are committed but NOT yet applied to remote: `npx supabase db push` failed on a pre-existing migration-history desync (remote versions 20260615153927 / 20260625201926 / 20260701122750 / 20260701122808 / 20260701143859 missing locally). Reconcile history (`supabase migration repair` / `db pull` on project `mwklvkmggmsintqcqfvu`) and push before any downstream phase writes to `folders`.
- (116-02) Migration 1227 must be applied AFTER 1226, BEFORE Phase 116 code deploys — the Wave 2 (116-03/116-04) swapped layouts/actions query `folders` and would break if the copy hasn't run. MEDIUM-HIGH risk (touches prod data + repoints two FKs). See PENDING-MIGRATIONS.md ## 3 for parity verify queries.

## Session Continuity

**Stopped At:** Completed Phase 116 Wave 1 (116-01 foldering core `itemFolderColumn` + 116-02 migration 1227 file/ledger; build green). Wave 2 (116-03 Projects swap, 116-04 Tools swap) pending — separate executor.
**Resume File:** None

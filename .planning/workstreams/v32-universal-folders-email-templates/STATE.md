---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: milestone
current_plan: Not started
status: completed
stopped_at: "Completed Phase 117 (both plans). 117-01 backend: migration 1228 (email_templates.folder_id + position + index) file-only + PENDING ledger #4, database.ts email_templates type carries folder_id/position, email-templates/_actions/folders.ts core delegation (entity_type='email_template'), listTemplates selects folder_id/position. 117-02 UI: EmailTemplateSubNav on DraggableTreeNav, settings/email-templates/layout.tsx (SubSidebarLayout storageKey sub-sidebar:email-templates), NewFolderButton made entity-agnostic (optional createFolder prop, Workflows unaffected), NewTemplateButton. Build green. Next: Phase 118 (Stable Block IDs). Reminder: migrations 1225/1226/1227/1228 remain unapplied — must reconcile migration-history desync + apply before this code deploys."
last_updated: "2026-07-02T16:51:27Z"
last_activity: 2026-07-02
progress:
  total_phases: 8
  completed_phases: 4
  total_plans: 10
  completed_plans: 10
---

# Project State

## Current Position

Phase: 118 (next)
Plan: 117-01, 117-02 all complete
Status: Phase 117 complete — Email Templates now consume the universal foldering stack. Backend: email_templates.folder_id/position (migration 1228 file + types), email-templates/_actions/folders.ts (entity_type='email_template'). UI: EmailTemplateSubNav (DraggableTreeNav) + settings/email-templates/layout.tsx (SubSidebarLayout), entity-agnostic NewFolderButton, NewTemplateButton. Build green. Migrations 1225/1226/1227/1228 still unapplied.
Last activity: 2026-07-02

## Progress

**Phases Complete:** 4 / 8
**Current Plan:** Not started
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
- (116-03) Projects `spaces.ts` rewritten as thin `'use server'` delegations to `@/lib/foldering/core` bound to `{ entityType:'project', itemTable:'projects', itemFolderColumn:'space_id' }`; all 8 exports + `ActionResult<ProjectSpaceRow>` shapes preserved (folders Row cast via `as unknown as`) so ProjectSubNav/layout untouched. `archiveSpace`/`deleteSpace` kept bespoke (core cascade hardcodes `folder_id`, ≠ `projects.space_id`) but read folder rows from `folders(entity_type='project')`. MCP `projects.ts` three `.from('project_spaces')` queries → `folders(entity_type='project')`; tool name `project_spaces_create` preserved. `projects.space_id` COLUMN references untouched.
- (116-04) Tool folder actions in `workflows/actions.ts` delegate to the core (entity_type='tool', itemTable='_legacy_tool_configs', default folder_id) via a `toLegacy()` adapter that maps `ActionResult<T>` back to the legacy bare-array (`getFolders`) / `{error?}|void` shapes the tools UI (tools-table.tsx, inline-tool-name.tsx) branches on — different from 116-03 which keeps ActionResult. `deleteFolder`/`deleteFolderWithTools`/`updateFolder(position)` hit `folders(entity_type='tool')` directly to preserve exact prior hard-delete/positional behavior; `moveToolToFolder` keeps its `_legacy_tool_configs.folder_id` update. Agent tool-picker (`agents/_actions/tools.ts`) type + query → `folders(entity_type='tool')`. After both swaps, `grep -rn "project_spaces\|tool_folders" src/` = only generated `database.ts` (+ intentional MCP tool name + a comment); `npm run build` exit 0.
- (117-01) Email templates gain folder linkage: migration 1228 (file-only) adds `email_templates.folder_id` (FK → `folders`, ON DELETE SET NULL) + `position` + index; `database.ts` `email_templates` Row/Insert/Update carry `folder_id`/`position` (+ folders FK relationship). `email-templates/_actions/folders.ts` is a thin `'use server'` module delegating to `@/lib/foldering/core` bound to `{ entityType:'email_template', itemTable:'email_templates' }` (default folder_id column), exposing the full TreeNavActions surface + `listFolders`/`createFolder` + `moveTemplateToFolder`/`reorderTemplatesInFolder`, revalidating `/settings/email-templates`. `listTemplates()` selects `folder_id`/`position`; `EmailTemplateBuilderRow` carries them. No lifecycle columns added to email_templates (core's archive/deleteFolder cascade is `as any` and not exercised in greenfield).
- (117-02) `/settings/email-templates` (list + new + [id] editor) now renders inside `SubSidebarLayout` via a NEW `settings/email-templates/layout.tsx` (storageKey `sub-sidebar:email-templates`, nested inside the settings sub-sidebar) — the other route group `email-templates/page.tsx` stays a pure redirect (untouched). `EmailTemplateSubNav` mirrors `WorkflowSubNav` on `DraggableTreeNav` (itemNoun='template', Mail icon inheriting folder color, `/settings/email-templates/<id>` hrefs, hard-delete via `deleteTemplate` with `deleteItemLabel='Delete'`, no `renameItem`, no footer). `NewFolderButton` made entity-agnostic via an OPTIONAL `createFolder` prop defaulting to the aliased workflows action (`createWorkflowFolder`) — Workflows call sites unchanged; the email layout/sub-nav pass the email-template `createFolder`. `npm run build` exit 0.

### Blockers/Concerns

- Phase 115 code is committed but migration 1226 is NOT applied — the swapped layout/actions query `folders`, so migration 1226 MUST be applied (AFTER 1225) before the Phase 115 code deploys, or the Workflows sidebar will show no folders. See PENDING-MIGRATIONS.md.
- Runtime/data parity for Workflows folders (existing folders unchanged + full CRUD) is a deferred human-verify — only checkable after 1226 runs against production.
- Migration `1225_universal_folders.sql` (and now `1226`, `1227`) are committed but NOT yet applied to remote: `npx supabase db push` failed on a pre-existing migration-history desync (remote versions 20260615153927 / 20260625201926 / 20260701122750 / 20260701122808 / 20260701143859 missing locally). Reconcile history (`supabase migration repair` / `db pull` on project `mwklvkmggmsintqcqfvu`) and push before any downstream phase writes to `folders`.
- (116-02) Migration 1227 must be applied AFTER 1226, BEFORE Phase 116 code deploys — the Wave 2 (116-03/116-04) swapped layouts/actions query `folders` and would break if the copy hasn't run. MEDIUM-HIGH risk (touches prod data + repoints two FKs). See PENDING-MIGRATIONS.md ## 3 for parity verify queries.
- (117) Migration 1228 (additive `email_templates.folder_id`/`position`/index) must be applied AFTER 1225, BEFORE the Phase 117 code deploys — the email-templates layout/sub-nav query `folder_id`/`position` and would break if the columns don't exist. LOW risk (additive, reversible). See PENDING-MIGRATIONS.md ## 4. Runtime sidebar render/drag for email-template folders is post-apply human-verify (folders + email_templates.folder_id don't exist in the connected DB until 1225 + 1228 run).

## Session Continuity

**Stopped At:** Completed Phase 117 (both plans). 117-01 backend (migration 1228 file + database.ts types + email-templates/_actions/folders.ts core delegation + listTemplates select) and 117-02 UI (EmailTemplateSubNav + settings/email-templates/layout.tsx + entity-agnostic NewFolderButton + NewTemplateButton). Build green. Next: Phase 118 (Stable Block IDs + Normalization). Reminder: migrations 1225/1226/1227/1228 remain unapplied — must reconcile migration-history desync + apply before this code deploys.
**Resume File:** None

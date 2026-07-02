---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: milestone
current_plan: Not started
status: completed
stopped_at: Completed 115-02-PLAN.md (Workflows swapped onto universal folders via foldering core; build green); Phase 115 complete, ready for Phase 116
last_updated: "2026-07-02T15:53:05.000Z"
last_activity: 2026-07-02
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 4
  completed_plans: 4
---

# Project State

## Current Position

Phase: 116
Plan: 115-01 + 115-02 complete
Status: Phase 115 complete — migration 1226 written (workflow_folders → folders, file only) and Workflows code swapped onto the universal foldering core; build green
Last activity: 2026-07-02

## Progress

**Phases Complete:** 2 / 8
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

### Blockers/Concerns

- Phase 115 code is committed but migration 1226 is NOT applied — the swapped layout/actions query `folders`, so migration 1226 MUST be applied (AFTER 1225) before the Phase 115 code deploys, or the Workflows sidebar will show no folders. See PENDING-MIGRATIONS.md.
- Runtime/data parity for Workflows folders (existing folders unchanged + full CRUD) is a deferred human-verify — only checkable after 1226 runs against production.
- Migration `1225_universal_folders.sql` (and now `1226`) are committed but NOT yet applied to remote: `npx supabase db push` failed on a pre-existing migration-history desync (remote versions 20260615153927 / 20260625201926 / 20260701122750 / 20260701122808 / 20260701143859 missing locally). Reconcile history (`supabase migration repair` / `db pull` on project `mwklvkmggmsintqcqfvu`) and push before any downstream phase writes to `folders`.

## Session Continuity

**Stopped At:** Completed 115-02-PLAN.md (Workflows swapped onto universal folders via foldering core; migration 1226 written as file; build green); Phase 115 complete, ready for Phase 116
**Resume File:** None

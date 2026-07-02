---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: milestone
current_plan: Not started
status: completed
stopped_at: Completed 114-02-PLAN.md (universal foldering core `src/lib/foldering/core.ts` + smoke test); Phase 114 complete, ready for Phase 115
last_updated: "2026-07-02T15:36:35.897Z"
last_activity: 2026-07-02
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
---

# Project State

## Current Position

Phase: 115
Plan: 114-01 + 114-02 complete
Status: Phase 114 complete — universal folders backend schema + types (114-01) and shared foldering core (114-02) both executed
Last activity: 2026-07-02

## Progress

**Phases Complete:** 1 / 8
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

### Blockers/Concerns

- Phase 115 touches live Workflows folders in production — verify parity with real data before dropping the legacy table.
- Migration `1225_universal_folders.sql` is committed but NOT yet applied to remote: `npx supabase db push` failed on a pre-existing migration-history desync (remote versions 20260615153927 / 20260625201926 / 20260701122750 / 20260701122808 / 20260701143859 missing locally). Reconcile history (`supabase migration repair` / `db pull` on project `mwklvkmggmsintqcqfvu`) and push before any downstream phase writes to `folders`.

## Session Continuity

**Stopped At:** Completed 114-02-PLAN.md (universal foldering core `src/lib/foldering/core.ts` + smoke test); Phase 114 complete, ready for Phase 115
**Resume File:** None

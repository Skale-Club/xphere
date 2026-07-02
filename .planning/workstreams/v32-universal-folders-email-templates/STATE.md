---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: milestone
current_plan: "114-02"
status: in_progress
stopped_at: "Completed 114-01-PLAN.md (universal folders migration + database.ts types)"
last_updated: "2026-07-02T13:57:05.609Z"
last_activity: 2026-07-02 — Milestone v3.2 roadmap created from approved plan (bright-booping-stream)
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 2
  completed_plans: 1
---

# Project State

## Current Position

Phase: 114 (Universal Folders Backend)
Plan: 114-01 complete → 114-02 next
Status: In progress — plan 114-01 executed (universal folders backend schema + types)
Last activity: 2026-07-02 — Executed 114-01: additive `public.folders` migration (1225) + database.ts types

## Progress

**Phases Complete:** 0 / 8
**Current Plan:** 114-02 (114-01 complete)
**Roadmap:** 114 → 121 (linear; 116 and 117 depend on 114)

## Accumulated Context

### Decisions

- Unify all folder tables (`workflow_folders`, `project_folders`, `tool_folders`) into one `folders` table with an `entity_type` discriminator; migrate all existing modules in this milestone (user decision, 2026-07-02).
- Shared logic in `src/lib/foldering/core.ts`; each module keeps a thin `'use server'` wrapper (Next Server Action semantics).
- Migrations preserve folder UUIDs so existing `folder_id` FKs stay valid — zero loss of production folders.
- Email blocks gain stable `id` via upgrade-on-read (`normalizeDocument`), no destructive data migration.
- UI is already generic (`DraggableTreeNav` + `SubSidebarLayout`); reuse, don't rebuild.

### Blockers/Concerns

- Phase 115 touches live Workflows folders in production — verify parity with real data before dropping the legacy table.
- Migration `1225_universal_folders.sql` is committed but NOT yet applied to remote: `npx supabase db push` failed on a pre-existing migration-history desync (remote versions 20260615153927 / 20260625201926 / 20260701122750 / 20260701122808 / 20260701143859 missing locally). Reconcile history (`supabase migration repair` / `db pull` on project `mwklvkmggmsintqcqfvu`) and push before any downstream phase writes to `folders`.

## Session Continuity

**Stopped At:** Completed 114-01-PLAN.md (universal folders migration + database.ts types); ready for 114-02
**Resume File:** None

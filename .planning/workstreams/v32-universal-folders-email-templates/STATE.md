---
workstream: v32-universal-folders-email-templates
gsd_state_version: 1.0
milestone: v3.2
milestone_name: Universal Foldering + Email Templates
created: 2026-07-02
current_plan: Not started
status: in_progress
last_updated: "2026-07-02T13:25:00.333Z"
last_activity: 2026-07-02
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Current Position

Phase: 114 (Universal Folders Backend)
Plan: —
Status: Planned — ready to plan Phase 114
Last activity: 2026-07-02 — Milestone v3.2 roadmap created from approved plan (bright-booping-stream)

## Progress

**Phases Complete:** 0 / 8
**Current Plan:** Not started
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

## Session Continuity

**Stopped At:** Roadmap + requirements written; ready for `/gsd:plan-phase 114 --ws v32-universal-folders-email-templates`
**Resume File:** None

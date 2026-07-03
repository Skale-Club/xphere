---
gsd_state_version: 1.0
milestone: v3.3
milestone_name: Settings Nav Cleanup + Unified Templates
current_plan: Not started
status: roadmapped
stopped_at: "Roadmap created: 4 phases (122-125) derived from the 14 v3.3 requirements (NAV-01..04, MSG-01..05, WAT-01..05), 100% coverage validated. Phase 122 (Settings Nav Cleanup, NAV-01/02) and Phase 123 (WhatsApp Templates Relocation + Search/Filter, WAT-01..05) have no interdependency and may run in either order or in parallel with Phase 124 (Messages Templates Data Model + CRUD, MSG-01..04). Phase 125 (Messages Preview + Templates Nav Finalization, MSG-05, NAV-03/04) depends on both 123 and 124 so the renamed 'Templates' section has real Email/Messages/WhatsApp entries to point to. No plans created yet — next step is /gsd:plan-phase 122 (or 123/124)."
last_updated: "2026-07-02T00:00:00.000Z"
last_activity: 2026-07-02
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Current Position

Phase: 122 of 125 (Settings Nav Cleanup) — ready to plan
Plan: 0 of TBD in current phase
Status: Roadmap approved; no plans created yet
Last activity: 2026-07-02 — ROADMAP.md and REQUIREMENTS.md traceability written for workstream v33-unified-templates (Phases 122-125)

Progress: [░░░░░░░░░░] 0%

## Roadmap Summary

| Phase | Goal | Requirements | Depends on |
|-------|------|---------------|------------|
| 122. Settings Nav Cleanup | Remove Call Center link, move Chat Widget to Build | NAV-01, NAV-02 | Nothing |
| 123. WhatsApp Templates Relocation + Search/Filter | Real Settings route + search/status/category/language filters | WAT-01..05 | Nothing |
| 124. Messages Templates Data Model + CRUD | New org-scoped `message_templates` table + list/create/edit/delete UI | MSG-01..04 | Nothing |
| 125. Messages Preview + Templates Nav Finalization | Per-channel preview + Communications→Templates rename | MSG-05, NAV-03, NAV-04 | Phase 123, Phase 124 |

## Accumulated Context

### Decisions

- Phase ordering: NAV-03 (rename Communications→Templates) and NAV-04 (extensibility) are deferred to the last phase (125) so the renamed section has three real entries (Email, Messages, WhatsApp) to point to at rename time, rather than renaming a section that still has nav-orphaned or nonexistent content.
- Messages templates data model + basic CRUD (Phase 124) is split from per-channel preview (Phase 125) — the preview UI is additive once the override fields already exist and are editable.
- WhatsApp templates relocation (Phase 123) intentionally bundles search + filter with the nav move (WAT-01..05) since they touch the same existing page in one pass, with zero data-model changes (provider-synced tables untouched).

### Pending Todos

None yet.

### Blockers/Concerns

None yet — roadmap just created, no execution has started.

## Session Continuity

**Stopped At:** Roadmap created for v3.3 (workstream v33-unified-templates): 4 phases, 14/14 requirements mapped, 0 orphans. Next: `/gsd:plan-phase 122`.
**Resume File:** None

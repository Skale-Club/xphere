---
gsd_state_version: 1.0
milestone: v3.4
milestone_name: Calendar Reliability & Workflow Integrity
status: planning
last_updated: "2026-07-15T11:32:04.727Z"
last_activity: 2026-07-15
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-07-15 — Milestone v3.4 started

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
- Phase 122 executed as a pure data reshuffle within the static `SECTIONS` array in `settings-sub-nav.tsx` — no route changes, no visual redesign, single-task plan.
- Phase 124 plan 01 kept `message_templates` deliberately lean (no folder_id/position/status/document/html_snapshot) — no approval workflow or folder hierarchy for this template type in this milestone. `channel_overrides` is flexible JSONB with `sms`/`email`/`whatsapp` keys (matching the existing `campaigns.channel` enum values minus `calls`), not fixed columns, so future channels need no migration.
- Migration 1233 (`message_templates`) was intentionally NOT applied to the remote database as part of 124-01 — it is a code deliverable only, per CLAUDE.md sensitive-paths guidance and the project's pending-migrations backlog. The operator must run `npx supabase db push` (or apply via Supabase Management API) before the table exists in production; 124-02 UI will not function against prod until then.
- Phase 123 relocated the WhatsApp templates grouping logic into a new generic client component (`WhatsAppTemplatesFilters`) parameterized by a minimal `FilterableTemplate` shape and a `renderCard` callback, so the same filter UI serves both Meta Cloud and Zernio row types without duplicating filter/search logic per provider.
- Phase 124 plan 02 placed the new "Messages" Settings nav entry between "Email Templates" and "WhatsApp Templates" in the Communications section's items array (cosmetic ordering only); the "Communications" heading itself was left unchanged, since renaming it to "Templates" is explicitly Phase 125's job (NAV-03).
- [Phase 125]: Phase 125 plan 02: single-line heading rename ('Communications' to 'Templates') confirms NAV-04 extensibility was already satisfied by the existing static SECTIONS array shape — no structural change needed.
- [Phase 125]: Phase 125 plan 01: merged the standalone Default body block into the Tabs component as a 5th sibling (Default/SMS/Email/WhatsApp/Preview), with Preview computed via useWatch — pure client-side derivation, no new server action or schema change

### Pending Todos

- Apply migration 1233 (`message_templates`) to the remote Supabase database — not yet applied. The Messages templates UI (124-02) is code-complete but will fail at runtime against production until `npx supabase db push` (or equivalent) is run.

### Blockers/Concerns

None — Phase 124 is fully complete (data model + CRUD UI); Phase 125 is now unblocked since both of its dependencies (Phase 123 and Phase 124) are done. Operator still needs to apply migration 1233 to prod (see Pending Todos).

## Session Continuity

**Stopped At:** Completed 125-01-PLAN.md (Messages Preview) and 125-02-PLAN.md (Templates Nav Finalization) — both plans of Phase 125 done. 125-01 added a live-resolved 5th 'Preview' tab (Default/SMS/Email/WhatsApp/Preview) to the Messages template editor via useWatch; 125-02 renamed Settings sub-nav 'Communications' heading to 'Templates'. Phase 125 fully complete; v3.3 milestone nav-finalization goal complete pending formal verification/close-out.
**Resume File:** None

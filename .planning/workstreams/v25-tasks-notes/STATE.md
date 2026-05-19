---
gsd_state_version: 1.0
milestone: v2.5
milestone_name: milestone
status: verifying
last_updated: "2026-05-19T03:10:53.517Z"
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
---

# Xphere - State (v2.5 Tasks & Notes CRM System)

## Current Position

Phase: 76 (db-foundation) — COMPLETE
Plan: 2 of 2
Next: Phase 77 (TASKS-ACTIONS) — server actions for tasks CRUD
Status: Phase 76 complete — both migrations + TypeScript types done

### Completed Plans

- 76-01: Migration 067 — tasks table + enums + RLS (commit 396b8ac, 2026-05-19)
- 76-02: Migration 068 — notes table + TypeScript types for tasks + notes (commits 115a502, dc5cc51, 2026-05-18)

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: ✅ Shipped 2026-05-07
- v1.7 Google Contacts Integration: ✅ Shipped 2026-05-07
- v1.8 Executor Completeness: ✅ Shipped 2026-05-08
- v1.9 GHL Lost-Lead Reengagement (SMS): ✅ Shipped 2026-05-16
- v2.0 Multi-Bot Platform: ✅ Shipped 2026-05-17
- v2.1 Calls + Contacts + Pipeline + Design Foundation: ✅ Shipped 2026-05-17
- v2.2 Chat Redesign: 🚧 separate workstream
- v2.3 Integrations Refactor + Twilio Multi-Number: 🚧 human_uat
- v2.4 CRM Expansion: ✅ Shipped 2026-05-19
- **v2.5 Tasks & Notes CRM System: 🔲 In Progress (this workstream)**

## Phase Map (v2.5)

| # | Phase | Domain | UI? | Depends on |
|---|-------|--------|-----|------------|
| 76 | DB-FOUNDATION | DB + types | no | — |
| 77 | TASKS-ACTIONS | server actions | no | 76 |
| 78 | TASKS-LIST-UI | UI | yes | 77 |
| 79 | NOTES-ACTIONS | server actions | no | 76 |
| 80 | NOTES-LIST-UI | UI | yes | 79 |
| 81 | ENTITY-INTEGRATION | UI + sidebar | yes | 78, 80 |

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/workstreams/v25-tasks-notes/ROADMAP.md` for v2.5 phase details.

**Core value:** Xphere is a tenant-aware integration and orchestration platform — reusable platform capabilities over hardcoding any single client's playbook.
**App name:** Xphere
**Production origin:** https://xphere.skale.club
**Next migration number:** 069

## Accumulated Context

### v2.5 Scope

Two coupled CRM primitives — Tasks and Notes — modeled after standard CRM systems (HubSpot, Pipedrive, Close CRM). Both are:

- Multi-tenant (RLS via get_current_org_id())
- Polymorphically linked to contacts/accounts/opportunities via entity_type + entity_id
- Accessible from standalone pages (/dashboard/tasks, /dashboard/notes)
- Accessible inline from entity detail pages (contact, account, opportunity)

**Tasks** are action-items with priority, status, due dates, and optional assignment to a user.
**Notes** are freeform text records with optional pinning and entity association.

### Key Design Decisions

- DB enums: task_priority (low/medium/high/urgent), task_status (todo/in_progress/done/cancelled), crm_entity_type (contact/account/opportunity) — shared by tasks and notes
- Forms: react-hook-form + zod + zodResolver (project standard)
- Toasts: sonner (project standard)
- Auth: getUser() + createClient() from @/lib/supabase/server (project standard)
- Server actions only (no separate API routes)
- RLS handles org scoping — never manually filter by org_id in queries
- UI components: shadcn/ui primitives (project standard)

## Pending Todos

- ⚠️ v2.3 HUMAN-UAT still owed — orthogonal, no overlap with v2.5
- 🧹 npm run lint broken (Next.js 16 removed next lint) — not blocking, use npm run build

---
gsd_state_version: 1.0
milestone: v1.6
milestone_name: ManyChat Integration
status: defining_requirements
stopped_at: Milestone v1.6 started — defining requirements
last_updated: "2026-05-06T00:00:00.000Z"
last_activity: 2026-05-06
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Operator - State

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-06 — Milestone v1.6 started

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: 🚧 Active

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `projects/manychat-integration/PLANNING.md` for v1.6 seed document.

**Core value:** The Action Engine must work reliably for every tenant
**App name:** Operator
**Production origin:** https://operator.skale.club

## Accumulated Context

### v1.6 Decisions

- ManyChat is a trigger source — not a Vapi equivalent. Same orchestration engine, new inbound surface.
- No HMAC signing on inbound webhook (ManyChat limitation) — shared secret header `X-Operator-Secret`
- Always HTTP 200 after secret validation to prevent ManyChat retries on application errors
- One ManyChat account per org (`UNIQUE(org_id)`) — relaxable in future migration
- Flows created manually in ManyChat UI; `getFlows` API used only for flow selector dropdown
- Event log (`manychat_events`) is append-only — full audit trail preserved
- Standardized payload template provided to admin for ManyChat External Request config

## Pending Todos

- Run `npx supabase db push` when SUPABASE_DB_PASSWORD is available (migrations 018-020 + 025 pending)

## Session Continuity

Last session: 2026-05-06
Stopped at: v1.6 milestone started — requirements being defined

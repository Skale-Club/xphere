---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Tools Folder System
status: defining_requirements
stopped_at: Milestone v1.5 started — defining requirements
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
Last activity: 2026-05-06 — Milestone v1.5 started

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: 🚧 Active

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/codebase/chat-data-boundary.md` for chat data lifecycle.

**Core value:** The Action Engine must work reliably for every tenant
**App name:** Operator
**Production origin:** https://operator.skale.club

## Accumulated Context

- v1.0 (2026-04-03) — MVP: 6 phases, 30 plans
- v1.1 (2026-04-03) — Knowledge Base: LangChain + pgvector
- v1.2 (2026-04-05) — Operator branding + embeddable chat widget
- v1.3 (2026-05-05) — Google Reviews + Meta Messaging
- v1.4 (2026-05-05) — Chat System Refactor (stream/chat-area split, realtime, search, docs)

## Active Tech Debt

- No HMAC validation on Vapi webhooks (vapi/calls and vapi/tools)
- Campaign calls don't appear in Observability
- `send_sms` and `custom_webhook` action types are stubs

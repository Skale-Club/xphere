---
gsd_state_version: 1.0
milestone: v1.8
milestone_name: Vapi Webhook Security
status: defining_requirements
stopped_at: Milestone started — defining requirements
last_updated: "2026-05-07T19:45:00.000Z"
last_activity: 2026-05-07
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
Last activity: 2026-05-07 — Milestone v1.8 started

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: ✅ Shipped 2026-05-07
- v1.7 Google Contacts Integration: ✅ Shipped 2026-05-07 ⚠️ pending Google Cloud credentials
- v1.8 Vapi Webhook Security: 🚧 Active

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/ROADMAP.md` for phase details.

**Core value:** The Action Engine must work reliably for every tenant
**App name:** Operator
**Production origin:** https://operator.skale.club

## Accumulated Context

### v1.8 Scope

- Target: `/api/vapi/tools`, `/api/vapi/calls`, `/api/vapi/campaigns`
- Pattern reference: Meta webhook HMAC-SHA256 (src/app/api/meta/webhook/route.ts)
- Env var: `VAPI_WEBHOOK_SECRET` already exists
- Failure mode: return 401, still log the attempt, never 500
- Vapi signs with `x-vapi-signature` header (sha256 HMAC of raw body)

## Pending Todos

- ⚠️ (v1.7) Register Google OAuth app in Google Cloud Console + set GOOGLE_CLIENT_ID/SECRET in Vercel

## Session Continuity

Last session: 2026-05-07T19:45:00.000Z
Stopped at: Milestone v1.8 started — requirements next

---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Google Reviews Widget + Meta Messaging
status: executing
last_updated: "2026-05-04T19:09:18.012Z"
last_activity: 2026-05-04
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
---

# Operator - State

## Current Position

Milestone: v1.3 Google Reviews Widget + Meta Messaging
Phase: 8
Plan: Not started
Status: Ready to execute
Last activity: 2026-05-04

## Progress Bar

```
v1.3: [ ][ ][ ][ ][ ][ ][ ]  0/7 phases complete
```

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3: 🔲 In progress — Phase 7 not started

## Project Reference

See `.planning/PROJECT.md` (updated 2026-05-04)

**Core value:** The Action Engine must work reliably for every tenant
**App name:** Operator
**Production origin:** https://operator.skale.club
**Current focus:** Phase 7 — DB Foundation

## Phase Map (v1.3)

| Phase | Name | Status |
|-------|------|--------|
| 7 | DB Foundation | Not started |
| 8 | Reviews Admin | Not started |
| 9 | Reviews Widget | Not started |
| 10 | Meta OAuth | Not started |
| 11 | Meta Webhook | Not started |
| 12 | Multi-Channel Inbox UI | Not started |
| 13 | Outbound Reply Routing | Not started |

## Accumulated Context

- v1.0 shipped 2026-04-03 — 6 phases, 30 plans, full MVP
- v1.1 shipped 2026-04-03 — LangChain vector pipeline, schema migration 010
- v1.2 shipped 2026-04-05 — Operator brand, embeddable widget, chat inbox; 6 phases, 21 plans
- Active known tech debt: no HMAC validation on Vapi webhooks, campaign calls don't appear in Observability, send_sms/custom_webhook are stubs
- v1.2 chat inbox: conversations/conversation_messages tables; AdminChatLayout/ConversationList/ChatArea components; bot_status per conversation
- Module 2 must extend existing chat inbox — NOT create a new one
- Conversations table will gain `channel TEXT DEFAULT 'widget'` and `channel_metadata JSONB DEFAULT '{}'` in Migration 020
- Last migration shipped in v1.2 was 017; v1.3 starts at 018
- Google reviews are an ephemeral cache (fetched_at required; 30-day ToS boundary); place_id is the only field durable beyond cache lifetime
- Meta App Review (Advanced Access) must be submitted after Phase 10 is functional; Business Verification should start before Phase 7 code begins
- Phase 13 (outbound reply routing) modifies the production POST /api/chat/conversations/[id]/messages route — highest-risk change, must be last
- Raw body must be read as text before HMAC verification in the Meta webhook handler (request.text(), not request.json())
- Full token exchange chain required: short-lived user token → long-lived user token → Page Access Token (only page token stored, encrypted)

## Key Decisions

| Decision | Status |
|----------|--------|
| All three migrations land together in Phase 7 | Decided — unblocks parallel Google and Meta work |
| Phases 8-9 (Google Reviews) and Phase 10 (Meta OAuth) can build in parallel after Phase 7 | Decided |
| Modify existing reply route (branch on channel) rather than create parallel route | Open — see research/SUMMARY.md Decision 4 |
| Async webhook processing via after() vs meta_webhook_queue table | Open — see research/SUMMARY.md Decision 2 |
| Maximum cache age for Google reviews | Open — 30 days is ToS-safe boundary; 7 days may be better UX |

## Blockers

- Meta Business Verification must be submitted (no engineering dependency; takes 2-5 business days)
- Test Facebook Page and Instagram Business account needed for development testing before Phase 10
- Vercel environment variables to set before Phase 8/10: GOOGLE_PLACES_API_KEY, META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN

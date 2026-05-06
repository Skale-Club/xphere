---
gsd_state_version: 1.0
milestone: v1.6
milestone_name: ManyChat Integration
status: executing
stopped_at: Completed 23-inbound-routing/23-03-PLAN.md
last_updated: "2026-05-06T20:38:46.740Z"
last_activity: 2026-05-06
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 6
  completed_plans: 5
---

# Operator - State

## Current Position

Phase: 23 (Inbound Routing) — EXECUTING
Plan: 4 of 4
Status: Ready to execute
Last activity: 2026-05-06

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: 🚧 Active — Phase 22 plans complete (2 of 2), ready for verification

## v1.6 Phase Summary

| Phase | Goal | Status |
|-------|------|--------|
| 22. Foundation | Receive + log webhook events; channel CRUD with encrypted API key | Plans Complete (2/2) — pending verification |
| 23. Inbound Routing | Rule-based dispatch to action engine | Not started |
| 24. Dashboard Config UI | Self-serve setup page (UI) | Not started |
| 25. Outbound Actions | manychat_* executors in action engine | Not started |
| 26. Rules UI + Event Log | Rules CRUD UI + event log with filters (UI) | Not started |

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/REQUIREMENTS.md` for v1.6 requirement traceability.
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
- ROUTING-01 and ROUTING-02 span two phases: backend (Phase 23) + UI surface (Phase 26)
- (22-01) `manychat_events.Update` typed as `Record<string, never>` to mirror SQL append-only RLS in the TS layer
- (22-01) Wave 0 RED tests use dynamic `await import()` so missing modules surface as ERR_MODULE_NOT_FOUND per test rather than failing collection
- (22-01) Extending `integration_provider` enum requires updating cross-cutting unions: `integrations.provider` Row/Insert, `IntegrationForDisplay.provider`, and `PROVIDER_LABELS` map
- (22-02) Webhook resolves `org_id` via service-role lookup of `manychat_channels` by `webhook_secret` — never trusts `org_id` from request body
- (22-02) Webhook always returns 200 after secret validation passes; outer try/catch swallows all post-gate errors to prevent ManyChat retry storms
- (22-02) `createManychatChannel` does NOT return `webhook_secret` to caller — Phase 24 UI fetches it via separate getter to avoid leaking through revalidation

### Architecture Notes

- New tables: `manychat_channels`, `manychat_rules`, `manychat_events` — all with RLS `USING (org_id = get_current_org_id())`
- Enum extensions: `action_type` += manychat_set_field, manychat_add_tag, manychat_trigger_flow, manychat_send_message; `integration_provider` += manychat
- Webhook endpoint: `/api/manychat/webhook` (Node.js runtime, always returns 200 post-validation)
- Client module: `src/lib/manychat/` — outbound API calls using decrypted per-org key

## Pending Todos

- Run `npx supabase db push` when SUPABASE_DB_PASSWORD is available (migrations 018-020 + 025 pending, plus new v1.6 migrations)

## Session Continuity

Last session: 2026-05-06T20:38:46.736Z
Stopped at: Completed 23-inbound-routing/23-03-PLAN.md

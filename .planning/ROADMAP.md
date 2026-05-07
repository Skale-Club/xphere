# Operator Roadmap

## Milestones

- ✅ **v1.0 MVP** — 6 phases, 30 plans (shipped 2026-04-03)
- ✅ **v1.1 Knowledge Base** — LangChain vector pipeline (shipped 2026-04-03)
- ✅ **v1.2 Operator + Embedded Chatbot** — 6 phases, 21 plans (shipped 2026-04-05)
- ✅ **v1.3 Google Reviews Widget + Meta Messaging** — 7 phases (phases 7–13, shipped 2026-05-05)
- ✅ **v1.4 Chat System Refactor** — 5 phases (phases 14–18, shipped 2026-05-05) — see [v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- ✅ **v1.5 Tools Folder System** — 3 phases (phases 19–21, shipped 2026-05-06)
- 🚧 **v1.6 ManyChat Integration** — 5 phases (phases 22–26, in progress)

## Shipped

<details>
<summary>✅ v1.0 MVP — SHIPPED 2026-04-03</summary>

See [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

- [x] Phase 1: Foundation
- [x] Phase 2: Action Engine
- [x] Phase 3: Observability
- [x] Phase 4: Knowledge Base
- [x] Phase 5: Outbound Campaigns
- [x] Phase 6: API Key Admin

</details>

<details>
<summary>✅ v1.1 Knowledge Base — SHIPPED 2026-04-03</summary>

See [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

- [x] Data Layer — LangChain schema, match_documents RPC
- [x] File Pipeline — upload → chunk → embed → pgvector
- [x] URL Pipeline — scrape → chunk → embed → pgvector
- [x] UI & Wiring — limits, OpenAI banner, AlertDialog, semantic search

</details>

<details>
<summary>✅ v1.2 Operator + Embedded Chatbot — SHIPPED 2026-04-05</summary>

See [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

- [x] Phase 1: Foundation — Redis, Supabase schema, brand rename, static widget asset (completed 2026-04-04)
- [x] Phase 2: Chat API — POST /api/chat/[token], session management, conversation persistence (completed 2026-04-04)
- [x] Phase 3: AI Conversation Engine — SSE streaming, knowledge base pre-retrieval, action engine tool calls (completed 2026-04-04)
- [x] Phase 4: Widget Embed Script — Shadow DOM widget, esbuild pipeline, browser-verified (completed 2026-04-04)
- [x] Phase 5: Admin Configuration — widget config page, live preview, embed code, token regen (completed 2026-04-05)
- [x] Phase 6: Chat Inbox — ConversationList + ChatArea + AdminChatLayout, sidebar Chat group (completed 2026-04-05)

</details>

<details>
<summary>✅ v1.3 Google Reviews Widget + Meta Messaging — SHIPPED 2026-05-05</summary>

See [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

- [x] Phase 7: DB Foundation — Migrations 018/019/020 (google_locations, meta_channels, channel columns) (completed 2026-05-04)
- [x] Phase 8: Reviews Admin — Location registration, Google Places API sync, dashboard (completed 2026-05-04)
- [x] Phase 9: Reviews Widget — Embeddable script, 4 layouts, public token endpoint (completed 2026-05-04)
- [x] Phase 10: Meta OAuth — Facebook Login, full token exchange chain, channel settings (completed 2026-05-04)
- [x] Phase 11: Meta Webhook — Inbound event receiver, conversation creation, 24h enforcement (completed 2026-05-05)
- [x] Phase 12: Multi-Channel Inbox UI — Channel icons, filter pills, header, banners, bot pause/resume (completed 2026-05-05)
- [x] Phase 13: Outbound Reply Routing — Branch reply route by channel (Messenger/Instagram/widget) (completed 2026-05-05)

</details>

<details>
<summary>✅ v1.4 Chat System Refactor — SHIPPED 2026-05-05</summary>

See [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)

- [x] Phase 14: Test Baseline — Stale test alignment with current schema
- [x] Phase 15: stream.ts Decomposition — 5 focused modules, TOOL_SCHEMAS deduplicated
- [x] Phase 16: chat-area.tsx Decomposition — 4 sub-components + 77-LOC orchestrator
- [x] Phase 17: Realtime Inbox — postgres_changes subscriptions, org-scoped filter
- [x] Phase 18: Chat Data Boundary — Documentation + search debounce

</details>

<details>
<summary>✅ v1.5 Tools Folder System — SHIPPED 2026-05-06</summary>

- [x] Phase 19: DB Foundation — tool_folders table, RLS, data migration from flat folder string (completed 2026-05-06)
- [x] Phase 20: Folder & Subfolder CRUD — create, rename inline, delete with confirmation modal (completed 2026-05-06)
- [x] Phase 21: Drag and Drop — folder reorder + tool move between folders (completed 2026-05-06)

</details>

---

## 🚧 v1.6 ManyChat Integration (In Progress)

**Milestone Goal:** Add ManyChat as a trigger source — a ManyChat flow fires an External Request → Operator routes it to any configured action (GHL, Twilio, etc.) and can push back to ManyChat as an action output.

### Phases

- [x] **Phase 22: Foundation** — DB migrations (manychat_channels, manychat_events, enum extensions), webhook endpoint with secret verification, channel server actions
 (completed 2026-05-06)
- [x] **Phase 23: Inbound Routing** — manychat_rules table, payload parser, rule matcher, action dispatch (completed 2026-05-06)
- [x] **Phase 24: Dashboard Config UI** — /integrations/manychat setup page (API key form, webhook URL + secret + payload template display, test connection) (completed 2026-05-07)
- [ ] **Phase 25: Outbound Actions** — manychat_* action_type enum values, src/lib/manychat/ client module, executors registered in action engine
- [ ] **Phase 26: Rules UI + Event Log** — /integrations/manychat/rules CRUD UI with flow selector, /integrations/manychat/events log with filters + pagination

## Phase Details

### Phase 22: Foundation
**Goal**: Operator can receive and log inbound ManyChat webhook events, and admins can register a ManyChat channel (with encrypted API key and webhook secret) via server actions
**Depends on**: Nothing (first phase of this milestone)
**Requirements**: CHANNEL-01, CHANNEL-05, WEBHOOK-01, WEBHOOK-02, WEBHOOK-03, WEBHOOK-04
**Success Criteria** (what must be TRUE):
  1. Admin can create a ManyChat channel by providing an API key — the key is stored encrypted (AES-256-GCM) and only a masked hint is returned to the UI
  2. Admin can delete a ManyChat channel and the record is removed from the database
  3. A POST to /api/manychat/webhook with a valid X-Operator-Secret header returns HTTP 200 and the event appears in manychat_events
  4. A POST to /api/manychat/webhook with an invalid or missing X-Operator-Secret header returns HTTP 403 and no event is logged
  5. Every accepted inbound event is logged to manychat_events with status unmatched (before routing is wired)
**Plans**: 2 plans
Plans:
- [x] 22-01-PLAN.md — Migration 026 + database.ts types + Wave 0 test stubs
- [x] 22-02-PLAN.md — Channel server actions + webhook POST handler

### Phase 23: Inbound Routing
**Goal**: Inbound ManyChat webhook events are matched against routing rules and dispatched to the existing action engine
**Depends on**: Phase 22
**Requirements**: ROUTING-01 (backend), ROUTING-02 (backend), ROUTING-03, ROUTING-04
**Success Criteria** (what must be TRUE):
  1. A routing rule can be created in the database mapping an event_type + condition JSONB to a tool_config action
  2. A routing rule can be updated and deleted via server actions
  3. When a webhook payload matches a rule (event_type + condition), the bound tool_config action executes via the existing action engine
  4. The manychat_events row for a matched event is updated with status matched and linked to the resulting action_logs entry via action_log_id
  5. When no rule matches, the manychat_events row is logged with status unmatched and no action fires
**Plans**: 4 plans
Plans:
- [x] 23-01-PLAN.md — Migration 027 + database.ts type widening + Wave 0 RED test stubs
- [x] 23-02-PLAN.md — resolveRule + resolveToolById + dispatchManychatEvent modules + logAction extension
- [x] 23-03-PLAN.md — Rule CRUD server actions (createManychatRule, updateManychatRule, deleteManychatRule, getManychatRules)
- [x] 23-04-PLAN.md — Webhook integration (inline dispatch) + extended webhook tests

### Phase 24: Dashboard Config UI
**Goal**: Admins have a complete self-serve setup flow to connect ManyChat and get everything they need to configure the External Request in ManyChat
**Depends on**: Phase 22
**Requirements**: CHANNEL-02, CHANNEL-03, CHANNEL-04
**Success Criteria** (what must be TRUE):
  1. Admin can navigate to /integrations/manychat and see a form to enter an API key
  2. Admin can copy the generated webhook URL (https://operator.skale.club/api/manychat/webhook) and webhook secret directly from the page
  3. Admin can copy a pre-formatted JSON payload template from the page to paste into ManyChat External Request body config
  4. Admin can click a "Test Connection" button that calls the ManyChat getFlows endpoint and shows success or an error message
**Plans**: 2 plans
Plans:
- [x] 24-01-PLAN.md — Server actions: getManychatChannel, testManychatConnection, MANYCHAT_PAYLOAD_TEMPLATE (TDD)
- [x] 24-02-PLAN.md — UI page: /integrations/manychat settings + root integrations page ManyChat card

### Phase 25: Outbound Actions
**Goal**: Operators can configure tool_configs that push data back to ManyChat (set fields, add tags, trigger flows, send messages) as action outputs
**Depends on**: Phase 22
**Requirements**: OUTBOUND-01, OUTBOUND-02, OUTBOUND-03, OUTBOUND-04
**Success Criteria** (what must be TRUE):
  1. A tool_config can be created with action_type manychat_set_field, manychat_add_tag, manychat_trigger_flow, or manychat_send_message
  2. When a manychat_add_tag action executes, the tag is added to the subscriber in ManyChat and the action_logs entry shows success
  3. When a manychat_set_field action executes, the custom field is updated on the subscriber in ManyChat
  4. When a manychat_trigger_flow action executes, the specified ManyChat flow is triggered for the subscriber
  5. When a manychat_send_message action executes, the message is delivered to the subscriber via ManyChat API
**Plans**: TBD

### Phase 26: Rules UI + Event Log
**Goal**: Admins can manage routing rules and browse inbound event history entirely from the dashboard without touching the database
**Depends on**: Phase 23, Phase 24
**Requirements**: ROUTING-01 (UI), ROUTING-02 (UI), OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. Admin can create a routing rule from /integrations/manychat/rules — selecting event_type, setting condition key/value pairs, picking a flow from the ManyChat flow selector dropdown, and binding it to a tool_config
  2. Admin can edit an existing rule and save changes, or delete a rule with a confirmation step
  3. Admin can navigate to /integrations/manychat/events and see a paginated list of all inbound events with their status (matched, unmatched, error) displayed
  4. Admin can filter the event log by status and date range and see only the matching events
  5. Admin can click any event row to view the full raw JSON payload that was received
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:** 22 → 23 → 24 → 25 → 26

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 22. Foundation | v1.6 | 2/2 | Complete    | 2026-05-06 |
| 23. Inbound Routing | v1.6 | 4/4 | Complete   | 2026-05-06 |
| 24. Dashboard Config UI | v1.6 | 2/2 | Complete   | 2026-05-07 |
| 25. Outbound Actions | v1.6 | 0/? | Not started | - |
| 26. Rules UI + Event Log | v1.6 | 0/? | Not started | - |

*Last updated: 2026-05-06 — Phase 24 planned (2 plans, 2 waves)*

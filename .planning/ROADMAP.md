# Operator Roadmap

## Milestones

- ✅ **v1.0 MVP** — 6 phases, 30 plans (shipped 2026-04-03)
- ✅ **v1.1 Knowledge Base** — LangChain vector pipeline (shipped 2026-04-03)
- ✅ **v1.2 Operator + Embedded Chatbot** — 6 phases, 21 plans (shipped 2026-04-05)
- ✅ **v1.3 Google Reviews Widget + Meta Messaging** — 7 phases (phases 7–13, shipped 2026-05-05)
- ✅ **v1.4 Chat System Refactor** — 5 phases (phases 14–18, shipped 2026-05-05) — see [v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)

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

---


*Last updated: 2026-05-05 — v1.4 milestone shipped and archived*

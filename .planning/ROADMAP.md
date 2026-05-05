# Operator Roadmap

## Milestones

- ✅ **v1.0 MVP** — 6 phases, 30 plans (shipped 2026-04-03)
- ✅ **v1.1 Knowledge Base** — LangChain vector pipeline (shipped 2026-04-03)
- ✅ **v1.2 Operator + Embedded Chatbot** — 6 phases, 21 plans (shipped 2026-04-05)
- 🔲 **v1.3 Google Reviews Widget + Meta Messaging** — 7 phases (phases 7–13, active)

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

---

## v1.3 Google Reviews Widget + Meta Messaging

### Phases

- [x] **Phase 7: DB Foundation** — All three migrations: google_locations/google_reviews, meta_channels, conversations channel columns (completed 2026-05-04)
- [x] **Phase 8: Reviews Admin** — Location registration, Google Places API sync, admin dashboard with sync status (completed 2026-05-04)
- [x] **Phase 9: Reviews Widget** — esbuild bundle, 4 layouts, public token endpoint, embed code generation (completed 2026-05-04)
- [x] **Phase 10: Meta OAuth** — Facebook Login flow, full token exchange chain, channel settings page (completed 2026-05-04)
- [ ] **Phase 11: Meta Webhook** — Inbound event receiver, conversation creation, automation binding, 24h window enforcement
- [ ] **Phase 12: Multi-Channel Inbox UI** — Channel icons, filter bar, conversation header, 24h warning, bot pause/resume
- [ ] **Phase 13: Outbound Reply Routing** — Branch existing reply route by channel, send to Messenger/Instagram Send API

---

## Phase Details

### Phase 7: DB Foundation
**Goal**: All schema changes for v1.3 land in production so that no feature phase is blocked by a missing table or column
**Depends on**: Nothing (first phase of v1.3)
**Requirements**: *(No direct requirements — structural prerequisite for all v1.3 work)*
**Success Criteria** (what must be TRUE):
  1. Migration 018 applies cleanly: `google_locations` and `google_reviews` tables exist with RLS policies and `review_token`, `fetched_at`, `google_review_id` columns present
  2. Migration 019 applies cleanly: `meta_channels` table exists with RLS, `encrypted_page_access_token`, `channel_type`, `webhook_verified` columns present
  3. Migration 020 applies cleanly: `conversations` table has `channel TEXT DEFAULT 'widget'` and `channel_metadata JSONB DEFAULT '{}'` columns; all existing conversation rows have `channel = 'widget'` with no manual data migration
  4. `npx supabase db push` completes with no errors and `npm run build` passes with updated TypeScript types
**Plans**: 3 plans
Plans:
- [x] 07-01-PLAN.md — migrations 018 + 019 (google_locations, google_reviews, meta_channels tables)
- [x] 07-02-PLAN.md — migration 020 (add channel columns to conversations)
- [x] 07-03-PLAN.md — update TypeScript types in src/types/database.ts

### Phase 8: Reviews Admin
**Goal**: Admin can register Google locations and see up to 5 live reviews pulled from the Google Places API, with sync status visible from the dashboard
**Depends on**: Phase 7
**Requirements**: GREV-01, GREV-02, GREV-03, GREV-04, GREV-05
**Success Criteria** (what must be TRUE):
  1. Admin can register a location by entering a Place ID; after save, the location appears in the `/reviews` dashboard with name, address, and client label
  2. Admin clicks "Sync Reviews" and within 10 seconds the dashboard shows up to 5 reviews with author names, star ratings, and a "Last synced" timestamp
  3. Admin triggers a second sync within 24 hours and sees a rejection message — the system enforces the minimum 24h cooldown per location
  4. Dashboard shows last sync date, review count, and any API error message (e.g. invalid Place ID) per location
  5. The Google Places API key is never exposed in client-side network requests; all API calls occur server-side via server actions
**Plans**: 3 plans
Plans:
- [x] 08-01-PLAN.md — RED test stubs for addLocation, syncReviews, cooldown (Wave 0)
- [x] 08-02-PLAN.md — server actions (addLocation, syncReviews, deleteLocation) + sidebar nav + google-logo.svg (Wave 1)
- [x] 08-03-PLAN.md — /reviews page, loading.tsx, AddLocationForm, LocationCard, SyncButton components (Wave 2)

### Phase 9: Reviews Widget
**Goal**: Admin can generate an embeddable script tag that renders a branded Google Reviews widget on any HTML page without auth or live API calls at render time
**Depends on**: Phase 7
**Requirements**: GWDGT-01, GWDGT-02, GWDGT-03, GWDGT-04, GWDGT-05, GWDGT-06
**Success Criteria** (what must be TRUE):
  1. Admin copies an embed `<script>` tag from the dashboard and pastes it into a plain HTML file; the widget loads reviews with no console errors and no host-site CSS interference
  2. Widget renders in all 4 layouts (carousel, grid, list, compact) selectable via `data-layout` attribute; layout is visible and functional without a page reload
  3. Admin configures primary color, star color, and dark/light theme in the dashboard; the embedded widget reflects those settings on next page load
  4. Widget displays "Powered by Google" attribution on every layout and includes author names adjacent to their review text
  5. When the token is invalid or reviews data is unavailable, the widget silently disappears — no visible error, no broken layout, no JS errors thrown to the host page
**Plans**: 3 plans
Plans:
- [x] 09-01-PLAN.md - RED test stubs for public route, widget bundle, and built asset (Wave 0)
- [x] 09-02-PLAN.md - /api/reviews/[token] public route + reviews widget IIFE + build pipeline (Wave 1)
- [x] 09-03-PLAN.md - /reviews dashboard embed configurator, preview, and copy snippet flow (Wave 2)
**UI hint**: yes

### Phase 10: Meta OAuth
**Goal**: Admin can connect a Facebook Page (and its linked Instagram account) to the platform via Meta OAuth, with encrypted tokens stored and connection status visible in settings
**Depends on**: Phase 7
**Requirements**: META-01, META-02, META-03, META-04, META-05, META-06
**Success Criteria** (what must be TRUE):
  1. Admin clicks "Connect with Facebook," completes the OAuth flow, and returns to `/integrations/meta` where the connected Facebook Page and its linked Instagram account are listed with active status
  2. The stored token is a Page Access Token (not a short-lived user token); the full three-step exchange chain (short-lived → long-lived → page token) completes successfully before any token is written to the database
  3. Admin can disconnect a channel; after disconnect, the channel disappears from the connected list and its token row is removed from `meta_channels`
  4. When a token has been revoked (simulated via developer tools), the settings page shows a reconnect prompt rather than showing the channel as active
  5. Admin can assign an existing automation to an Instagram DM channel and independently assign a different automation to the Messenger channel for the same page
**Plans**: 3 plans
Plans:
- [x] 10-01-PLAN.md - RED test stubs for Meta OAuth actions, callback route, and settings UI (Wave 0)
- [x] 10-02-PLAN.md - Shared Meta OAuth helpers + connect/disconnect actions + callback token exchange route (Wave 1)
- [x] 10-03-PLAN.md - /integrations/meta dashboard UI, reconnect/disconnect controls, and automation binding (Wave 2)
**UI hint**: yes

### Phase 11: Meta Webhook
**Goal**: Inbound Instagram DMs and Facebook Messenger messages arrive in the existing chat inbox as new conversations, and configured automations fire on receipt with 24h window enforcement
**Depends on**: Phase 10
**Requirements**: METAEV-01, METAEV-02, METAEV-03, METAEV-04, METAEV-05
**Success Criteria** (what must be TRUE):
  1. Meta sends a GET verification challenge to `/api/meta/webhook` and the handler responds with the correct challenge value; webhook is confirmed active in the Meta App Dashboard
  2. A test Instagram DM sent to the connected account appears in the chat inbox within 5 seconds, with `channel = 'instagram'` and correct `channel_metadata` (igsid, page_id)
  3. A test Messenger message sent to the connected page appears in the chat inbox within 5 seconds with `channel = 'messenger'`
  4. When an automation with a keyword trigger is bound to the channel and the inbound message contains that keyword, the automation fires and `executeAction` is invoked; the response is persisted to the conversation
  5. An automated reply attempt on a conversation whose last inbound message is older than 24 hours is blocked — no outbound message is sent and the admin sees the conversation marked as outside the reply window
**Plans**: 2 plans
Plans:
- [x] 11-01-PLAN.md — migration 022 (last_inbound_at + meta_channels.config) + TypeScript types + RED test stubs (Wave 0)
- [ ] 11-02-PLAN.md — /api/meta/webhook route (GET + POST) + processMetaEvent lib + tests GREEN (Wave 1)

### Phase 12: Multi-Channel Inbox UI
**Goal**: The existing chat inbox correctly identifies the origin channel of every conversation so admins can filter, recognize, and manage widget, Instagram, and Messenger conversations from one view
**Depends on**: Phase 11
**Requirements**: METAINBOX-01, METAINBOX-02, METAINBOX-04, METAINBOX-05, METAINBOX-06
**Success Criteria** (what must be TRUE):
  1. Each conversation row in the inbox shows a channel icon and label (globe for website, recognizable icons for Instagram and Messenger); existing widget conversations retain their appearance unchanged
  2. Admin uses the channel filter to select "Instagram only" and the inbox shows only Instagram conversations; switching to "All" restores the full list without a page reload
  3. Opening a Meta conversation shows the channel name and connected account name in the conversation header, alongside the current bot status (active or paused)
  4. A conversation where the 24h Meta reply window has expired shows a visible warning banner in the chat area; the banner does not appear for widget conversations
  5. Admin clicks "Pause bot" on a Meta conversation and confirms that subsequent inbound messages no longer trigger automation; clicking "Resume bot" restores automation firing
**Plans**: TBD
**UI hint**: yes

### Phase 13: Outbound Reply Routing
**Goal**: When an admin manually replies in the inbox, the message is delivered to the correct channel — Messenger Send API, Instagram Messaging API, or existing widget path — with no risk of silent misdirection
**Depends on**: Phase 12
**Requirements**: METAINBOX-03
**Success Criteria** (what must be TRUE):
  1. Admin sends a reply in a Messenger conversation; the message is delivered to the user's Messenger thread and also persisted to the Supabase conversation — verified by receiving the reply on the test Messenger account
  2. Admin sends a reply in an Instagram conversation; the message is delivered to the user's Instagram DM thread and persisted — verified by receiving the reply on the test Instagram account
  3. Admin sends a reply in a widget conversation; behavior is identical to pre-v1.3 (persisted to DB, SSE polling picks it up) — existing widget chat is not disrupted
  4. A reply attempt on a channel whose token has been revoked returns an error in the UI rather than silently dropping the message; the admin sees a reconnect prompt
  5. Unit tests assert that for each of the three channel values (`widget`, `messenger`, `instagram`), the correct send function is invoked and no other channel's send path is reached
**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. DB Foundation | 3/3 | Complete    | 2026-05-04 |
| 8. Reviews Admin | 3/3 | Complete    | 2026-05-04 |
| 9. Reviews Widget | 3/3 | Complete    | 2026-05-04 |
| 10. Meta OAuth | 3/3 | Complete | 2026-05-04 |
| 11. Meta Webhook | 1/2 | In Progress|  |
| 12. Multi-Channel Inbox UI | 0/? | Not started | — |
| 13. Outbound Reply Routing | 0/? | Not started | — |

---

*Last updated: 2026-05-04 - Phase 11 planned, 2 plans created*

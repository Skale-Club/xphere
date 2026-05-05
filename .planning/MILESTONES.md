# Milestones

## v1.4 Chat System Refactor (Shipped: 2026-05-05)

**Stats:** 5 phases, 9 plans, 20 commits, 44 files, +3,413 / −962 lines
**Timeline:** 2026-05-04 → 2026-05-05 (single-session)
**Stack:** Next.js 15, Supabase Realtime, Vitest

**Key accomplishments:**

1. **Test baseline restored** — Fixed 3 stale tests (chat-persist + action-engine ACTN-02) that referenced renamed tables (`chat_sessions` → `conversations`); 151/151 passing baseline
2. **stream.ts decomposed** — 480 LOC entry split into 5 focused modules (encoder, tool-schemas, openrouter, anthropic) all <200 LOC; TOOL_SCHEMAS deduplicated; public API unchanged
3. **chat-area.tsx decomposed** — 408 LOC component split into 4 sub-components (ChatHeader, MessageList, MessageBanner, MessageComposer) all <150 LOC; orchestrator now 77 LOC; render output identical
4. **Chat data boundary documented** — `.planning/codebase/chat-data-boundary.md` explains conversations vs Redis cache lifecycle; source headers in `persist.ts`, `session.ts`, `chat/[token]/route.ts` link to the doc
5. **Admin inbox real-time** — Migration 024 enables Realtime publication on `conversations` + `conversation_messages`; `setInterval` polling replaced with `postgres_changes` subscriptions; org-scoped filter; cleanup on unmount
6. **Conversation search debounced** — 300ms debounce on the existing search input prevents per-keystroke filter recomputation

**UAT:** All 5 phases verified passed (16/16 must-haves across phases)

**Archives:** [v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md) | [v1.4-REQUIREMENTS.md](milestones/v1.4-REQUIREMENTS.md)

---

## v1.3 Google Reviews Widget + Meta Messaging (Shipped: 2026-05-05)

**Stats:** 7 phases, 18 plans, 33 commits
**Timeline:** 2026-05-04 → 2026-05-05
**Stack:** Next.js 15, Supabase, Meta Graph API, Google Places API, esbuild

**Key accomplishments:**

1. **Google Reviews integration** — Places API v1 sync with 24h cooldown, encrypted location storage; embeddable reviews widget (4 layouts, themable, public token endpoint)
2. **Meta OAuth** — Facebook + Instagram with full token exchange chain (short-lived → long-lived → page token); page tokens encrypted with AES-256-GCM
3. **Meta Webhook** — Unified `/api/meta/webhook` with HMAC-SHA256 verification, `after()` async processing, automation dispatch with keyword filter, 24h window enforcement
4. **Multi-channel inbox UI** — ChannelIcon (Globe/Instagram/Messenger), filter pills, enriched header (account name + bot status badge), 24h amber warning banner, bot pause/resume button
5. **Outbound reply routing** — POST handler branches on conversation.channel; widget unchanged, Meta channels dispatch via `sendMetaMessage` lib; error code 190 → reconnect prompt
6. **Two-tier settings system** — `platform_settings` (global, encrypted, super-admin only) + per-org `integrations`; `/settings/platform` admin page with Tabs UI

**UAT:** All 7 phases verified passed

**Archives:** [v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md) | [v1.3-REQUIREMENTS.md](milestones/v1.3-REQUIREMENTS.md)

---

## v1.2 Operator + Embedded Chatbot (Shipped: 2026-04-05)

**Stats:** 6 phases, 21 plans, 122 commits, 171 files, +26,190 / −1,886 lines
**Timeline:** 2026-04-03 → 2026-04-05 (2 days)
**Stack:** Next.js 15, Redis, Supabase, esbuild, Shadow DOM, LangChain, SSE

**Key accomplishments:**

1. **Platform renamed Operator** — brand rename (VoiceOps → Leaidear → Operator) across all UI, navigation, page titles, and branding
2. **Embeddable chat widget** — single `<script>` tag or GTM install, Shadow DOM CSS isolation, floating bubble, SSE streaming chat panel, localStorage session persistence
3. **Streaming AI conversation engine** — SSE-based streamed responses with knowledge base pre-retrieval (LangChain SupabaseVectorStore) and action engine tool calls mid-stream (OpenRouter + Anthropic)
4. **Dual-memory architecture** — Redis short-term session memory + Supabase long-term conversation history; `conversations`/`conversation_messages` tables with RLS
5. **Admin widget configuration** — per-org widget appearance (name, color, welcome message), live preview, embed code generator, token regeneration
6. **Chat inbox** — dual-polling ConversationList + ChatArea + AdminChatLayout for managing widget conversations; widget settings moved under Chat in sidebar

**UAT:** All 6 phases browser-verified (Phases 4, 5, 6 with explicit human checkpoint)

**Archives:** [v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) | [v1.2-REQUIREMENTS.md](milestones/v1.2-REQUIREMENTS.md)

---

## v1.1 Knowledge Base (Shipped: 2026-04-03)

**Stats:** 1 commit, 18 files, +2191 / -334 lines
**Timeline:** 2026-04-03 (single-session)
**Stack:** LangChain + Supabase pgvector, Next.js 15, Deno Edge Functions

**Key accomplishments:**

1. **LangChain vector pipeline** — Replaced custom chunking/embedding with LangChain `RecursiveCharacterTextSplitter` + `OpenAIEmbeddings` + `SupabaseVectorStore.fromDocuments()`
2. **Schema migration** — Renamed `documents` → `knowledge_sources` (tracking table), new LangChain-compatible `documents` table with `content/metadata/embedding vector(1536)`, `match_documents` RPC
3. **Semantic search upgrade** — `query-knowledge.ts` uses `SupabaseVectorStore.similaritySearch()` with `org_id` metadata filter for org isolation
4. **Per-org upload limits** — Max 5 files + 5 URLs enforced server-side; UI shows counters (X/5) and disables at limit
5. **OpenAI integration gate** — Upload form disabled and banner shown when org has no active OpenAI integration
6. **AlertDialog for deletions** — Replaced `window.confirm()` with shadcn `AlertDialog` across knowledge base UI

**UAT:** 10/10 tests passed (code audit + migration smoke test)

**Archives:** [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

---

## v1.0 VoiceOps MVP (Shipped: 2026-04-03)

**Stats:** 6 phases, 30 plans, 95 commits, 231 files, ~44K LOC
**Timeline:** 2026-03-30 → 2026-04-03 (4 days)
**Stack:** Next.js 14 (App Router), TypeScript, Supabase (PostgreSQL + RLS + pgvector), Vercel

**Key accomplishments:**

1. **Multi-tenant foundation** — Organizations, assistant mappings, Supabase RLS on all tables, email/password auth with middleware guards
2. **Action Engine** — Edge Function webhook receiver processes Vapi tool calls in <500ms, executes GoHighLevel actions (create contact, check availability, book appointment), logs every execution
3. **Observability** — End-of-call webhook ingestion, paginated call list with 5 filter types, chat-format transcript with inline tool execution badges, dashboard metrics
4. **Knowledge Base** — Document upload (PDF/text/CSV/URL), OpenAI embedding vectorization via Deno Edge Function, tenant-scoped semantic search (pgvector + match_document_chunks RPC)
5. **Outbound Campaigns** — Campaign CRUD, CSV contact import with deduplication, Vapi outbound dialing with cadence control, Supabase Realtime per-contact status board
6. **API Key Admin** — All third-party API keys (OpenAI, Anthropic, OpenRouter, Vapi) migrated from env vars to per-org encrypted integrations with AES-256-GCM

**Audit:** 42/42 requirements wired, 8/8 E2E flows pass, tech_debt status (no blockers)

**Known gaps (accepted as tech debt):**

- No Vapi webhook HMAC/secret validation
- Campaign calls don't auto-appear in Observability call list (deployment config gap)
- 132 todo test stubs (pre-existing)
- send_sms / custom_webhook are v2 stubs

**Archives:** [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) | [v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md) | [v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md)

---

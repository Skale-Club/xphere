# Operator

## What This Is

A multi-tenant SaaS platform that serves as the operational layer for agencies running AI assistants. It centralizes action execution, knowledge base workflows, outbound campaigns, call observability, and embeddable chat widgets in one admin panel so agencies can scale beyond a single-client setup.

Operator is not meant to encode one universal agency workflow. It is the shared integration and orchestration substrate that lets each client organization run its own operational flow on top of common primitives such as assistant mappings, provider credentials, tool execution, outbound calling, observability, and customer-facing chat.

## Core Value

**The Action Engine must work.** When an AI assistant (voice or chat) triggers a tool during a live interaction, the platform must identify the tenant, execute the business logic, and return a result fast enough for production flows.

That business logic may differ by client. The invariant is the reliability of the execution path, not that every tenant follows the same pattern.

## Current Milestone: v1.5 Tools Folder System

**Goal:** Transformar o módulo de tools em um explorador organizado com pastas de 2 níveis, renomear inline, e mover tools com drag and drop.

**Target features:**
- Pasta > Subpasta (2 níveis), inline collapsible na tabela
- Criar subpasta via botão (+) no header da pasta pai
- Renomear pasta: click inline na label → input, Enter confirma
- Mover tool entre pastas: arrastar sobre header da pasta destino
- Deletar pasta: modal de confirmação (orphan tools ou deletar)
- DnD de reordenação de pastas (melhorar o existente)

---

## Last Shipped: v1.4 ✅ Shipped 2026-05-05

**Shipped in v1.4 (Chat System Refactor):**
- `stream.ts` (480 LOC) split into 5 focused modules (encoder, tool-schemas, openrouter, anthropic, entry); TOOL_SCHEMAS deduplicated
- `chat-area.tsx` (408 LOC) split into ChatHeader, MessageList, MessageBanner, MessageComposer + 77-LOC orchestrator
- `.planning/codebase/chat-data-boundary.md` documents the `conversations` vs Redis cache lifecycle
- Migration 024 enables Supabase Realtime publication on `conversations` and `conversation_messages`
- Admin inbox: `setInterval` polling replaced with `postgres_changes` subscriptions, org-scoped filter, cleanup on unmount
- Conversation search debounced at 300ms
- Test baseline restored: chat-persist + action-engine tests aligned with current schema

**Production:** `https://operator.skale.club`

---

## Last Shipped (previous): v1.3 ✅ Shipped 2026-05-05

**Shipped in v1.3 (Google Reviews Widget + Meta Messaging):**
- Google Places API integration with 24h cooldown, encrypted location storage
- Embeddable reviews widget (4 layouts, themable, public token endpoint)
- Meta OAuth — Facebook + Instagram with full token exchange chain (page tokens encrypted)
- Meta Webhook (`/api/meta/webhook`) — HMAC-SHA256, after() async processing
- Multi-channel inbox UI — ChannelIcon, filter pills, enriched header, 24h banner, bot pause/resume
- Outbound reply routing — branched POST handler dispatches to widget/messenger/instagram
- Two-tier settings system — `platform_settings` (global) + `integrations` (per-org)

**Production:** `https://operator.skale.club`

## Last Shipped (previous): v1.2 ✅ Shipped 2026-04-05

**Shipped in v1.2 (Operator + Embedded Chatbot):**
- Platform name: Operator (branding, navigation, page titles)
- Embeddable chat widget — single `<script>` / GTM install, Shadow DOM, SSE streaming, localStorage session
- Streaming AI conversation engine — SSE, knowledge base pre-retrieval, action engine tool calls mid-stream
- Short-term memory: Redis (active session context)
- Long-term memory: Supabase `conversations`/`conversation_messages` with RLS
- Admin widget config page — name, color, welcome message, live preview, embed code, token regen
- Chat inbox — ConversationList, ChatArea, AdminChatLayout, dual polling, admin reply

**Production:** `https://operator.skale.club`

## Requirements

### Validated

- Admin can create and manage organizations (tenants) — v1.0
- Admin can link Vapi assistant IDs to specific organizations — v1.0
- Admin can configure integration credentials per organization (GoHighLevel + 7 providers) — v1.0
- Admin can configure tools with trigger-action logic per organization — v1.0
- Platform can serve as the orchestration layer for client-specific workflows built from shared tenant-aware primitives — v1.0
- Platform receives Vapi tool-call webhooks via Next.js route handlers and routes to the correct organization — v1.0
- Platform executes GoHighLevel actions (create contact, check availability, book appointment) — v1.0
- Platform logs every tool execution with status, timing, and request/response payloads — v1.0
- Platform receives end-of-call webhooks and stores transcripts, summaries, and call metadata — v1.0
- Admin can view call list with filters — v1.0
- Admin can view call detail with transcript and inline tool execution badges — v1.0
- Admin can view dashboard metrics and recent activity — v1.0
- Platform processes documents into vectorized chunks via OpenAI embeddings in pgvector — v1.0, upgraded to LangChain pipeline — v1.1
- Platform serves knowledge base queries during calls via tenant-scoped semantic search — v1.0, LangChain SupabaseVectorStore with org_id filter — v1.1
- Admin can manage knowledge base documents (files + URLs, 5 each per org, with status indicators) — v1.1
- Admin can create outbound campaigns with CSV contact import — v1.0
- Platform dials contacts via Vapi Outbound API with cadence and real-time status — v1.0
- Multi-tenant data isolation via Supabase RLS on all tables — v1.0
- User authentication via Supabase Auth — v1.0
- Per-org API key management with AES-256-GCM encryption — v1.0
- Per-org public widget token (no visitor login required) — v1.2 Phase 2 (INFRA-03)
- Redis short-term memory for active chat sessions — v1.2 Phase 2 (CHAT-04)
- Supabase long-term memory for conversation history — v1.2 Phase 2 (CHAT-05)
- Public chat API endpoint (POST /api/chat/[token]) with session management and message persistence — v1.2 Phase 2 (CHAT-06)
- Streamed SSE AI responses (session/token/tool_call/done protocol) via ReadableStream — v1.2 Phase 3 (CHAT-01)
- Knowledge base pre-retrieval context injection into system prompt before LLM call — v1.2 Phase 3 (CHAT-02)
- Action engine tool invocation mid-stream (OpenRouter + Anthropic fallback, GHL credentials) — v1.2 Phase 3 (CHAT-03)
- Embeddable chat widget (public/widget.js) installable via single script tag or GTM — Shadow DOM isolation, floating bubble, SSE chat panel, localStorage session persistence — v1.2 Phase 4 (WIDGET-01..05)
- Cross-origin widget calls supported — CORS headers + OPTIONS preflight on POST /api/chat/[token] — v1.2 Phase 4 (WIDGET-04)
- Per-org widget configuration (name, color, welcome message) — v1.2 Phase 5 (ADMIN-01)
- Admin page to configure, preview, and get embed code for the widget — v1.2 Phase 5 (ADMIN-02..03)
- Token regeneration for widget auth invalidation — v1.2 Phase 5 (ADMIN-04)
- Runtime widget config hydration from public config endpoint — v1.2 Phase 5
- Admin chat inbox — conversation list, message thread, reply, status filter, search — v1.2 Phase 6 (INBOX-01..07)

### Active (next milestone candidates)

- Vapi webhook HMAC/secret validation on `/api/vapi/*` routes
- `send_sms` action type (Twilio executor)
- `custom_webhook` action type (configurable URL, method, headers, body)
- Campaign calls auto-appear in Observability call list
- Client-facing read-only panel (member role dashboard)
- Email alerts on tool execution failures or latency threshold
- Widget analytics dashboard (message volume, session count, resolution rate)
- Visitor identity collection (optional name/email before chat)
- Conversation handoff to human agent
- Real-time operator monitoring of live widget chats

### Out of Scope

- Voice processing (STT/TTS) — handled by Vapi
- Assistant configuration — handled in Vapi
- LLM conversation logic for Vapi flows — handled by Vapi
- Payment and billing — outside current scope
- Mobile app
- OAuth/social login
- White-label branding
- Widget visitor authentication beyond public org token
- Widget A/B testing

## Context

- **v1.0** shipped 2026-04-03 — 6 phases, 30 plans, full MVP
- **v1.1** shipped 2026-04-03 — LangChain vector pipeline, schema migration 010
- **v1.2** shipped 2026-04-05 — platform rename (Operator), embeddable widget, chat inbox
- Tech stack: Next.js 15, TypeScript strict, Supabase (PostgreSQL + pgvector + Auth), Tailwind 4, shadcn/ui, LangChain, esbuild
- Deployment: Vercel Hobby (app), Supabase (data/auth/background), GitHub Actions (auxiliary cron)
- Canonical production origin: `https://operator.skale.club`
- Vapi webhook routes run in Node.js route handlers (not Edge Runtime) for Vercel Hobby compatibility
- Auth enforced in layouts and route handlers (not middleware)
- Known tech debt: no Vapi HMAC validation, campaign calls don't appear in Observability, send_sms/custom_webhook are stubs

## Constraints

- Tech stack: Next.js App Router, TypeScript strict mode, Supabase, Vercel Hobby, shadcn/ui
- Deployment: avoid depending on Vercel Edge Runtime or Vercel Cron for core product flows
- Multi-tenancy: Supabase RLS on all tenant tables is non-negotiable
- Encryption: integration credentials must remain encrypted with AES-256-GCM
- Vapi webhooks: always return HTTP 200 and stay fast
- No n8n fallback
- Widget embed: must work as a plain `<script>` tag with no framework dependency on the host site
- Widget auth: per-org public token only — no visitor login, no cookies on host site
- Redis: short-term session only — Supabase is the system of record for conversations
- Do not overfit the product model around a single client playbook when the same outcome can be represented as tenant-specific configuration or orchestration
- First-party webhook construction must use `https://operator.skale.club` as the public base URL

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Admin panel first, client panel later | Agency validates value before exposing clients | ✓ Good |
| GoHighLevel as first integration | First real customer uses it | ✓ Good |
| Client workflows stay tenant-specific by default | Agencies need different operational automations even when they share the same platform | Current product framing |
| `operator.skale.club` is the canonical public origin | Prevents webhook drift across preview URLs, legacy relays, and ad hoc hostnames | Current deployment target |
| Node.js route handlers for Vapi routes on Vercel Hobby | Keeps the app compatible with the free Vercel plan without relying on Edge Runtime | ✓ Good |
| Auth enforced in layouts and route handlers | Avoids depending on Vercel middleware for session gating | ✓ Good |
| Supabase RLS for multi-tenant isolation | Protects data even when app code is wrong | ✓ Good |
| pgvector for RAG instead of external vector DB | Keeps the stack simple and co-located | ✓ Good |
| Per-org API keys in DB instead of env vars | Enables tenant-specific integrations | ✓ Good |
| LangChain as vector abstraction (v1.1) | Community-maintained, clean API for chunk/embed/search | ✓ Good |
| `metadata.org_id` for vector isolation (v1.1) | Follows LangChain SupabaseVectorStore conventions | ✓ Good |
| Widget embed as script tag (v1.2) | Works in any site without framework dependency; GTM compatible | ✓ Validated Phase 4 |
| Redis for chat session memory (v1.2) | Fast in-session context without hitting Supabase on every message | ✓ Validated Phase 2 |
| Public org token for widget auth (v1.2) | Visitors don't need accounts; org isolation maintained server-side | ✓ Validated Phase 2 |
| Widget config on `organizations` table (v1.2) | Avoids extra join/table; natural multi-tenant scope via RLS | ✓ Good |
| Shadow DOM isolation for widget (v1.2) | Prevents host-site CSS bleed without iframe overhead | ✓ Validated Phase 4 |
| `conversations`/`conversation_messages` naming (v1.2) | More readable table names; denormalized last_message for inbox previews | ✓ Good |

## Evolution

Update this file whenever deployment assumptions, validated requirements, or core constraints change.

*Last updated: 2026-05-06 — v1.5 milestone started (Tools Folder System)*

# Operator

## Current Milestone: v3.2 Credits Visibility & Metering Architecture

**Goal:** Make credit balance visible across the platform and establish a reusable credit-metering architecture that other features can plug into later, backed by test coverage and failure observability.

**Target features:**
- Persistent credit balance indicator in the global sidebar/header (visible whenever the org's plan includes credits)
- Generic, reason/feature-tagged credit-debit architecture that workflows/campaigns/calls can plug into later without redesign — no live debit wired for those features yet, Copilot remains the only debiting feature
- Automated test coverage for billing: checkout, Stripe webhook handling, entitlements resolution, credit debit/credit RPCs
- Observability/alerting for billing failures: Stripe webhook failures and silent credit-debit failures

**Workstream:** `billing-robustness` (parallel to `v31-websites-lead-ingestion`, which has completed all 3 phases as of 2026-06-21 but is still pending formal `/gsd:complete-milestone` close-out)

**Progress:** Phase 114 (Metering Architecture) complete 2026-07-01 — `meterDebit()` generic credit-debit interface (MET-01..04) replaces the Copilot-specific `debitCopilot`; migration 1225 adds the `reason` tag column.

**Progress:** Phase 115 (Credit Balance Visibility) complete 2026-07-01 — `CreditsIndicator` in the global TopBar/MobileMenu (CRB-01..04), Realtime-backed live updates via migration 1226. 5 items pending real click-through verification (`115-HUMAN-UAT.md`) — approved on code/test evidence since the connected browser session couldn't reach the local dev server.

**Progress:** Phase 116 (Billing Test Coverage) complete 2026-07-01 — 48 new/audited tests across `tests/billing-webhook.test.ts`, `tests/billing-credit-rpcs.test.ts`, `tests/billing-checkout-sessions.test.ts`, `tests/billing-entitlements-unit.test.ts` (BTC-01..04). Real HMAC-signed Stripe webhook testing, RPC wrapper contract coverage.

**Progress:** Phase 117 (Billing Observability) complete 2026-07-01 — Stripe webhook and `meterDebit` failure paths now write to the existing `event_logs` table (source `stripe-webhook`/`billing-credits`); surfaced via the existing `/admin/logs` page with zero new UI (BOB-01..03). All 15/15 v3.2 requirements complete — milestone target phases (114-117) done.

## Previous: v3.1 Websites Lead Ingestion ✅ Phases complete 2026-06-21 (pending formal close-out)

**Goal:** Accept completed lead-form submissions from Skale Club Websites through a secure, idempotent, organization-scoped API and expose each accepted submission to Xphere workflows.

**Target features:**
- Add least-privilege `leads:write` API keys and consistent scope enforcement
- Add a versioned lead-ingestion API with organization identity derived from the bearer key
- Persist every unique lead submission independently from CRM contact deduplication
- Create or update the correct CRM contact without overwriting richer tenant-managed data
- Emit `lead.captured` for every accepted submission and `contact.created` only for new contacts
- Publish integration validation and public API documentation for the sibling Websites product

**Note:** All 3 phases (111-113) completed per `workstreams/v31-websites-lead-ingestion/STATE.md`; run `/gsd:complete-milestone --ws v31-websites-lead-ingestion` to archive formally when convenient.

## What This Is

A multi-tenant SaaS platform that serves as the operational layer for agencies running AI assistants. It centralizes action execution, knowledge base workflows, outbound campaigns, call observability, and embeddable chat widgets in one admin panel so agencies can scale beyond a single-client setup.

Operator is not meant to encode one universal agency workflow. It is the shared integration and orchestration substrate that lets each client organization run its own operational flow on top of common primitives such as assistant mappings, provider credentials, tool execution, outbound calling, observability, and customer-facing chat.

## Core Value

**The Action Engine must work.** When an AI assistant (voice or chat) triggers a tool during a live interaction, the platform must identify the tenant, execute the business logic, and return a result fast enough for production flows.

That business logic may differ by client. The invariant is the reliability of the execution path, not that every tenant follows the same pattern.

## Previous: v2.9 UX Polish & Feature Completeness ✅ Shipped 2026-05-20

3 phases (102–104): Workflows Unification (merged Automations + Visual Flows into one system), In-App Notification System (bell, dropdown, Realtime, DB persistence), Light Theme (full light mode, toggle, system-preference detection). Plus: landing page polish, header reorganization, flow canvas UX overhaul, Companies standardization, deal panel redesign.

## Previous: v2.8 Scheduling Hardening ✅ Shipped 2026-05-19

4 phases (93–96): partial unique index (migration 072) + rate limiter, Resend booker emails, custom fields integration on auto-created contacts, and 14/14 passing tests for slots + bookings.

## Previous: v2.7 Unified Calls Hub + Pipeline UX ✅ Shipped 2026-05-19

8 phases (85–92): unified /calls hub merging AI+Human calls, tabs sub-routes, detail variants, sidebar cleanup, OpportunityDetailSheet, DnD fix, same-column kanban reorder.

## Previous: v2.6 Admin Panel + Landing Page + SEO ✅ Shipped 2026-05-19

3 phases (82–84), super admin panel + landing page + SEO structure. Migrations 069 (org settings jsonb) + 070 (seo_config table) applied.

## Previous: v2.5 Tasks & Notes CRM System ✅ Shipped 2026-05-19

6 phases (76–81), tasks + notes CRM with full CRUD, overdue indicators, pinned notes, entity integration. Migrations 067 (tasks) + 068 (notes) applied.

## Previous: v2.4 CRM Expansion ✅ Shipped 2026-05-19

**12 phases, 93 commits, 167 files, +31,256 / −31 lines — single-session marathon.**

v2.4 delivers a complete CRM upgrade: Companies as a first-class entity, a structured custom fields layer across all three entity types, and a production-grade bulk contact import pipeline.

**Accounts (SEED-016):** `accounts` table + RLS + idempotent migration from `contacts.company`. Full CRUD/merge/CSV-import server actions. `/dashboard/accounts` list with filters/search/bulk, combobox in contact form, TopCompanies widget, detail page with Contacts/Opportunities/Activities tabs, email-domain auto-suggest, two-path opportunity creation.

**Custom Fields (SEED-017):** `custom_field_definitions` table with 13-type ENUM and per-entity reserved-key enforcement. Pure-function validation lib wired into all 3 entity server actions. Settings page with dnd-kit drag-reorder, groups, archive. `CustomFieldsForm`/`CustomFieldsDisplay` rendered in every form and detail page. Dynamic columns + type-aware filters in list views. CSV import mapping + export expansion.

**Contact Import Pipeline (SEED-018):** `contact_imports` + `contact_import_errors` tables, Realtime publication, pg_cron 30-day cleanup, Storage bucket with per-org path RLS. 7-stage mapping wizard with direct-to-Storage XHR upload (signed URL, byte-level progress), auto-mapping heuristics, dedup picker, dry-run preview. process-imports Deno Edge Function with chunked/cancellable/concurrency-capped execution, account auto-create, Realtime progress, imports history + detail pages, error CSV export, retry-failed flow.

**Pending operator action:** v2.3 (Integrations Refactor + Twilio Multi-Number) still in `human_uat` in `workstreams/v23-integrations-multi-number` — orthogonal, no overlap.

## Previous In-Flight: v2.3 Integrations Refactor + Twilio Multi-Number 🚧 human_uat

6/6 phases complete in `workstreams/v23-integrations-multi-number/`. Awaiting operator manual testing per `phases/63-polish/63-HUMAN-UAT.md` before close. Orthogonal to v2.4 — does not block.

## Current State: v2.1 CRM + Omnichannel + Complete Redesign ✅ Shipped 2026-05-17

**5 waves, 8 migrations (048-055) applied to remote Supabase.**

v2.1 delivers a full vertical: contact management, sales pipeline, inbound SMS, voice calls (3 routing modes), Google Reviews monitoring, Evolution Go WhatsApp coexistence, and a complete visual redesign at the Linear/Vercel quality bar — all under one tenant-aware platform.

**Wave 1 — Design Foundation (SEED-010 R1-R3):** Dark-mode-first design system, motion tokens, command palette (Cmd+K), redesigned sidebar with grouped nav, MetricCard/ActivityChart/ActivityFeed primitives, skeleton library, ChannelBadge/StatusPill, empty-state components.

**Wave 2 — Domain features (SEED-004..009):** Evolution Go WhatsApp instances, Twilio SMS inbound, contact CRM with tags/sources/CSV import, voice call system with 3 routing modes (phone forward / SIP / browser), Google Reviews via SerpAPI with public widget, sales pipeline with kanban + opportunities + activity feed.

**Wave 3 — Page redesigns (SEED-010 R4-R6):** Every dashboard page reskinned against the new system — dashboard hero with animated metrics, conversations inbox, contacts list, integrations grid, agents, knowledge, members, reviews — all consistent.

**Wave 4 — Integrations & polish (SEED-010 R5-R6):** Pipeline kanban with optimistic drag-drop, contact detail sheet with opportunity history, pipeline widget on dashboard, settings nav consolidation.

**Wave 5 — Final polish (SEED-010 R7-R8, this commit):**
- Per-org branding: logo upload, accent color picker, optional brand name (migration 055)
- Workspace settings page with live preview and auto-saved indicators
- Settings nav layout: 2-column with Workspace / Profile / Integrations / Calls / Team / Billing / Notifications / API Keys / Platform
- Profile settings: name + password update
- Onboarding tour: custom 5-step Portuguese tour with anchored tooltips, cookie-persistent dismissal
- Welcome dashboard: 5-item setup checklist for empty workspaces (WhatsApp, Twilio, agents, contacts, reviews)
- Confetti celebration on deal won (drag-to-won and explicit mark-won), accent palette colors
- Animated number counters on MetricCard (cubic ease-out count-up)
- Page transitions between routes (framer-motion fade + slide, mobile-skip, reduced-motion-aware)
- Optimistic delete for contacts table (fade-out + rollback on error)
- Toast improvements: bottom-right with close button, semantic colors, 4s auto-dismiss, 5-stack

**Migrations:** 048 (RLS agent_model_pricing), 049 (security fixes), 050 (sms_channel), 051 (contacts), 052 (google_reviews_serpapi), 053 (call_system), 054 (evolution_instances), 055 (org_branding).

**Pending operator action:** Configure Google Cloud Console OAuth client + enable Supabase Google provider + set `NEXT_PUBLIC_SITE_URL` on Vercel to activate Google SSO (carried over from v2.0).

## Previous Milestone: v2.0 Multi-Bot Platform ✅ Shipped 2026-05-17

**10 phases, 43 plans, 8 migrations (042-047) applied to remote Supabase.**

Operator now has a first-class `agents` entity for all text channels. Every existing org was backfilled with a Main Agent byte-identical to v1.4 chat behavior. The platform supports multi-agent delegation with intersection authorization, prompt versioning with draft/publish flow, a multi-channel playground, per-agent observability, and Google SSO with team invites (pending operator Google Cloud Console config).

**Pending operator action:** Configure Google Cloud Console OAuth client + enable Supabase Google provider + set `NEXT_PUBLIC_SITE_URL` on Vercel to activate Google SSO (Phase 42-02).

## Last Milestone: v1.9 GHL Lost-Lead Reengagement (SMS) ✅ Complete 2026-05-16 ⚠️ pending operator HUMAN-UAT

**Goal:** Job diário automatizado que identifica leads marcados como `Lost` há mais de 180 dias no GoHighLevel (sub-account Skleanings) e dispara SMS de reengajamento, com anti-loop persistente para não enviar duas vezes ao mesmo contato.

**Shipped (Phase 32, 18 commits, 53/53 tests GREEN):**
- `src/lib/ghl/list-opportunities.ts` — `listOpportunities()` com paginação por cursor + defesa JS-side de data/status
- `src/lib/automations/ghl-reengagement/render-template.ts` — `renderMessage()` com fallback `amigo(a)`
- `src/lib/automations/ghl-reengagement/runner.ts` — `runReengagement()` orchestrator (244 LOC) com claim-first anti-loop, `Promise.allSettled`, log por tentativa
- `src/app/api/automations/ghl-reengagement/run/route.ts` — POST com bearer auth (`crypto.timingSafeEqual` + length-equality guard), DB-backed schedule check, `?force=1` bypass
- `.github/workflows/ghl-reengagement.yml` — pulse de 15 min com `workflow_dispatch` + `force` input
- `docs/automations/ghl-reengagement.md` — setup operacional completo
- Migrações 032 (`ghl_reengagement_sent` anti-loop) + 033 (`automation_schedules` cron registry com seed row) — aplicadas no remoto
- Decisão de design: SMS via GHL Conversations API (não Twilio direto) — uma única integração GHL faz list + dispatch
- Decisão de design: schedule mora no DB (`automation_schedules`), GH Action só pulsa — desacopla cadência do código

**Pendente operacional (não bloqueia commit/deploy):**
- Operator setar 4 env vars na Vercel + 2 secrets no GitHub
- Primeiro `workflow_dispatch --force=true` em produção
- Probe do nome do param de data GHL (constante atual `'date'` — JS-side guard cobre se errado)
- SMS de teste num contato opt-in
- Primeiro tick agendado 14:00 UTC

Itens persistidos em `.planning/phases/32-ghl-lost-lead-reengagement-sms-automation/32-HUMAN-UAT.md` — surfam em `/gsd:progress` até resolvidos.

## Last Milestone: v1.8 Executor Completeness ✅ Shipped 2026-05-08

**Goal:** Implement the 2 remaining action type stubs — `send_sms` via Twilio and `custom_webhook` with configurable URL/method/headers/body.

**Shipped:**
- `src/lib/twilio/send-sms.ts` — Twilio executor with credential resolution, Basic auth, URLSearchParams POST to Messages API
- `src/lib/custom-webhook/execute-webhook.ts` — configurable HTTP executor with `{{param}}` substitution, 10s AbortController timeout, 200-char truncated response
- `tool-config-form.tsx` — conditional fields: Twilio dropdown for `send_sms`, 4-field panel for `custom_webhook`
- Migration 031 — `tool_configs.integration_id` made nullable (custom_webhook needs no integration)

## Last Milestone: v1.7 Google Contacts Integration ✅ Complete 2026-05-07

**Goal:** Add Google Contacts as an integration provider — admins connect their Google account via OAuth per org, and 4 new action types become available in the action engine to create, update, find, and delete contacts.

**Target features:**
- Google OAuth per org (connect/disconnect em /integrations)
- Credenciais Google criptografadas (access token + refresh token) por org via AES-256-GCM
- 4 action types: `google_contacts_create`, `google_contacts_update`, `google_contacts_find`, `google_contacts_delete`
- Mapeamento de campos padrão (nome, email, telefone, empresa, notas)
- Dashboard UI para conectar conta Google e gerenciar a integração

---

## Last Milestone: v1.6 ManyChat Integration ✅ Complete 2026-05-07

**Goal:** Add ManyChat as a trigger source — a ManyChat flow fires an External Request → Operator routes it to any configured action (GHL, Twilio, etc.) and can push back to ManyChat as an action output.

**Target features:**
- Webhook ingestion (`/api/manychat/webhook`) with `X-Operator-Secret` verification + event audit log
- Inbound routing engine: `event_type` + condition JSONB → dispatch to existing tool_configs actions
- Dashboard setup UI: connect API key, copy webhook URL + secret + payload template
- Outbound actions: `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message` ✅ Phase 25 complete (2026-05-07)
- Rules manager UI + event log with status/date filters ✅ Phase 26 complete (2026-05-07)

---

## Last Shipped: v1.5 ✅ Shipped 2026-05-06

**Shipped in v1.5 (Tools Folder System):**
- `tool_folders` table with `parent_id` (2-level hierarchy), RLS, data migration from flat `folder: string`
- Folder + subfolder CRUD: create, rename inline (Enter/Escape), delete with confirmation modal (orphan or cascade)
- Collapsible sections inline in the tools table, Ungrouped section at bottom
- Drag-and-drop: folder reorder (persists via `position` column) + tool move between folders (highlight on hover)
- Folder Select in tool-config-form replacing free-text input

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
- `send_sms` action type executes via Twilio (Account SID + Auth Token per org, `from_number` from integration config) — v1.8
- `custom_webhook` action type fires configurable HTTP requests with `{{param}}` substitution, timeout, and truncated response — v1.8
- Admin can configure `send_sms` tool_config via Twilio integration dropdown in form — v1.8
- Admin can configure `custom_webhook` tool_config via URL/method/headers/body fields in form — v1.8
- Platform lists GHL Lost opportunities older than threshold (cursor-paginated, JS-side date/status defense) — v1.9 (REENG-01..04)
- Platform exposes bearer-protected POST `/api/automations/ghl-reengagement/run` returning typed RunnerResult — v1.9 (REENG-05..07)
- Platform substitutes `{{first_name}}` template with `amigo(a)` fallback for SMS body — v1.9 (REENG-08)
- Platform persists anti-loop in `ghl_reengagement_sent` (claim-first INSERT before send + DELETE on failure + UNIQUE race safety) — v1.9 (REENG-09..11)
- Platform logs every SMS attempt to `action_logs` with phone-redacted payload — v1.9 (REENG-12)
- Platform fires GitHub Action pulse every 15 min calling production endpoint with bearer auth + `workflow_dispatch` manual override — v1.9 (REENG-13..14)
- Platform reads runtime config from 4 required + 3 optional env vars with sensible defaults — v1.9 (REENG-15..16)
- Platform documents operator setup in `docs/automations/ghl-reengagement.md` — v1.9 (REENG-17)
- Platform owns automation cadence in DB via `automation_schedules` (interval-based, post-run write-back, `?force=1` bypass) — v1.9 (REENG-18)
- Schema: `agents` first-class entity with audit timestamps + `agent_tools` junction (per-agent tool scoping) + `agent_partners` recursive junction (multi-agent delegation) — v2.0 Phase 33 (AGENT-09, TOOL-01, DELEG-01)
- Schema: `agent_invocations` observability table with `parent_invocation_id` self-FK for delegation tree + `action_logs` extended with nullable `agent_invocation_id`/`trace_id` (additive) — v2.0 Phase 33 (OBS-01, OBS-02)
- Schema: `agent_model_pricing` global reference table seeded with 7 launch models (Anthropic + OpenAI + Google) — v2.0 Phase 33 (OBS-03)
- Schema: `manychat_rules.agent_id` + `meta_channels.agent_id` additive nullable columns (Phase 37 dispatcher branches on these) — v2.0 Phase 33 (CHAN-06)
- Every existing org has a seeded "Main Agent" with system_prompt byte-equal to v1.4 chat template + all active tool_configs granted + web_widget channel default — v2.0 Phase 33 (GATE-07 surrogate; literal verification in Phase 35)
- Accounts (Companies) as first-class entity: `accounts` table + RLS + idempotent migration, CRUD/merge/CSV-import server actions, list/detail UI with filters/bulk/tabs — v2.4 (ACC-01..19)
- Custom Fields system: `custom_field_definitions` table (13 types, 3 entities, reserved-key enforcement), server-side zod validation, settings UI with drag-reorder/groups/archive, `CustomFieldsForm`/`CustomFieldsDisplay` in all forms/detail pages, dynamic list columns+filters, CSV IO — v2.4 (CF-01..15)
- Contact Import Pipeline: queued background import with direct-to-Storage XHR upload (50MB/200k rows), mapping wizard, dedup preview, Realtime progress, per-row errors, retry-failed, account auto-create, imports history page — v2.4 (IMP-01..20)

### Validated (v2.5 + v2.6 + v2.7 additions)

- Tasks entity: createTask / updateTask / deleteTask / getTasks / toggleTaskDone with Zod validation + RLS — v2.5 (TSK-01..14)
- Notes entity: createNote / updateNote / deleteNote / getNotes / toggleNotePin, pinned-first ordering, content search — v2.5 (NOT-01..12)
- /tasks page with TasksTable (overdue indicators, priority/status badges), TaskForm + TaskSlideOver — v2.5
- /notes page with NotesGrid (pinned/unpinned sections, pin toggle), NoteForm + NoteSlideOver — v2.5
- Tasks + Notes panels embedded in Account and Opportunity detail pages — v2.5
- Super admin panel `/admin/*` restricted to platform admin email with service-role data access — v2.6 (ADM-01..06)
- Operational `event_logs` viewer moved to `/admin/logs`; direct tenant reads removed and filters support cross-tenant diagnostics by tenant/severity/status/source/period — post-v3.0 hardening (2026-05-27)
- Landing page with Framer Motion animations, dark-mode-first, fully responsive — v2.6 (LND-01..06)
- SEO structure: metadata, OG, sitemap, robots.txt, JSON-LD, `/admin/seo` config panel — v2.6 (SEO-01..06)
- Unified Calls Hub: `unified_calls` VIEW, `/calls` timeline with AI+Human filter, tabs sub-routes, detail variants — v2.7 (CALL-01..10)
- Pipeline UX: OpportunityDetailSheet with edit mode, DnD click/drag fix, same-column kanban reorder — v2.7 (PIPE-01..08)
- Scheduling Hardening: partial unique index, rate limiter, Resend booker emails, custom fields integration, 14 tests — v2.8 (SCHED-01..12)
- Stripe billing foundation (customers/subscriptions/webhook idempotency), trial + manual plan override, Copilot credit wallet (included + topup buckets, ledger, atomic RPCs), checkout + top-up sessions, entitlements resolution, settings/billing UI — shipped out-of-band across v2.8-v3.0 without dedicated REQ-IDs; hardened starting v3.2

### Backlog (next milestone candidates)

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
| Global Knowledge is the platform-level corpus; Notion may be its authoritative source | Keeps shared curated knowledge separate from tenant RAG while allowing edits, additions, moves, and deletions to converge through revisioned sync | Implemented 2026-06-28 |
| Widget embed as script tag (v1.2) | Works in any site without framework dependency; GTM compatible | ✓ Validated Phase 4 |
| Redis for chat session memory (v1.2) | Fast in-session context without hitting Supabase on every message | ✓ Validated Phase 2 |
| Public org token for widget auth (v1.2) | Visitors don't need accounts; org isolation maintained server-side | ✓ Validated Phase 2 |
| Widget config on `organizations` table (v1.2) | Avoids extra join/table; natural multi-tenant scope via RLS | ✓ Good |
| Shadow DOM isolation for widget (v1.2) | Prevents host-site CSS bleed without iframe overhead | ✓ Validated Phase 4 |
| `conversations`/`conversation_messages` naming (v1.2) | More readable table names; denormalized last_message for inbox previews | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

*Last updated: 2026-07-01 — v3.2 Credits Visibility & Metering Architecture started (workstream `billing-robustness`).*

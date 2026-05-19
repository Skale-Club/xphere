# Milestones

## v2.8 Scheduling Hardening (Shipped: 2026-05-19)

**Stats:** 4 phases, 7 plans, 12 commits — closes audit gaps from v2.7 scheduling review

**Key accomplishments:**

1. **Race condition eliminated** — partial unique index `(event_type_id, start_at) WHERE status='confirmed'` (migration 072); `createBooking` maps Postgres `23505` → `slot_taken` instead of leaking 500 (SCHED-01, SCHED-02)
2. **Rate limiter** — `src/lib/rate-limit.ts` Redis-backed fixed-window (5 bookings per IP+eventType per hour); fail-open if Redis unreachable; integrated into `createBooking` (SCHED-03)
3. **Booker emails** — `src/lib/scheduling/emails.ts` with Resend client; `sendBookingConfirmation` + `sendBookingCancellation` with HTML templates; soft-disabled when `RESEND_API_KEY` absent (SCHED-04, SCHED-05, SCHED-06)
4. **Email integration** — wired into `createBooking`, `cancelBookingByToken`, and dashboard `cancelBooking`; all fire-and-forget via `void` + `.catch` (SCHED-06)
5. **Custom fields integration** — `buildRequiredCustomFieldDefaults` queries org's required `custom_field_definitions` and seeds defaults respecting admin-set `default_value`; try/catch fallback creates contact without custom_fields_data on validation error (SCHED-07, SCHED-08)
6. **Test coverage** — `tests/scheduling-slots.test.ts` (8 cases: timezone, DST, advance notice, durations) + `tests/scheduling-bookings.test.ts` (6 cases: race condition via 23505 mock, cancel token validation, contact link) — 14/14 passing (SCHED-09..12)

**Operator actions:** ✅ migration 072 applied during audit · ⚠ set `RESEND_API_KEY` on Vercel · ⚠ verify Resend domain `bookings@xphere.skale.club`

**Archives:** [v2.8-ROADMAP.md](milestones/v2.8-ROADMAP.md) | [v2.8-REQUIREMENTS.md](milestones/v2.8-REQUIREMENTS.md) | [v2.8-MILESTONE-AUDIT.md](milestones/v2.8-MILESTONE-AUDIT.md)

---

## v2.7 Unified Calls Hub + Pipeline UX (Shipped: 2026-05-19)

**Stats:** 8 phases, 9 plans, 17 commits, 41 files, +2,685 / −2 lines
**Timeline:** 2026-05-19 (single session)

**Key accomplishments:**

1. **Unified Calls Hub** — `unified_calls` VIEW (migration 063) UNION ALL of `calls` (AI/Vapi) and `call_logs` (Human/Twilio) with `call_type` discriminator, `SECURITY INVOKER` RLS; `UnifiedCall` TypeScript type; `getUnifiedCalls` (filters: type/direction/missed/search/pagination) + `getUnifiedCall` with contact enrichment (CALL-01, CALL-02)
2. **Calls timeline UI** — `/calls` route group with tabs nav (Timeline/Campaigns/Assistants/Settings); `UnifiedCallTimeline` with date-grouped rows, TypeBadge (AI=violet, Human=muted), direction icons, status pills, recording/transcript badges, debounced search, URL-based pagination (CALL-03, CALL-04)
3. **Sub-routes + Settings** — `/calls/campaigns` and `/calls/assistants` inherit tabs layout; `/calls/settings` consolidates routing modes + Dialer + Twilio config with conditional banners; sidebar single "Calls" item; `/phone` and `/voice` redirect to `/calls` (CALL-05, CALL-06, CALL-09, CALL-10)
4. **Unified detail page** — `/calls/[id]` shared header shell + type-branch: `CallDetailAi` (transcript timeline via `buildTimeline`, cost, assistant ID) and `CallDetailHuman` (waveform player, notes editor, contact link) (CALL-07, CALL-08)
5. **Pipeline click/drag fix** — `OpportunityCard` `role="button"` + `onClick→openSheet`; `PointerSensor distance:6` prevents accidental drags; `OpportunityDetailSheet` (Dialog) with Info/Activity/Notes tabs, full edit mode (title/value/stage/contact combobox/tags/custom fields), `updateOpportunity` on save (PIPE-01..06)
6. **Kanban same-column reorder** — `reorderOpportunities(stageId, orderedIds[])` batch-updates `position` column; `onDragEnd` splice-based optimistic update with rollback on error (PIPE-07, PIPE-08)

**Archives:** [v2.7-ROADMAP.md](milestones/v2.7-ROADMAP.md) | [v2.7-REQUIREMENTS.md](milestones/v2.7-REQUIREMENTS.md)

---

## v2.6 Admin Landing SEO (Shipped: 2026-05-19)

**Stats:** 3 phases, 10 summaries, 56 files, +3,998 / −230 lines
**Timeline:** 2026-05-19 (single session)

**Key accomplishments:**

1. **Super Admin Panel** — `/admin/*` route group restricted to `skale.club@gmail.com`; `(admin)` layout with `AdminSidebar`; service-role server actions for org listing with parallel usage counts, org detail with member resolution via `auth.admin.listUsers`, `updateOrgSettings` jsonb patch; `OrgsTable`, `OrgDetailView` components (ADM-01..06)
2. **Platform Settings** — `/admin/settings` with `getPlatformStats` (6 parallel counts), `bulkApplyFeatureFlag` patching all orgs in parallel; `PlatformSettingsView` with 6 stat cards and feature-flag toggle UI (ADM-05)
3. **Landing Page** — `/` public route with `LandingPage` component: hero, features grid (6 items), pricing CTA; Framer Motion stagger entrance + `whileInView` scroll reveal; dark-mode-first, fully responsive at sm/lg breakpoints; authenticated users redirect to `/dashboard`
4. **Auth Redesign** — `/login` split-layout with dark left panel (feature bullets, stagger animations) and right auth form; `(auth)` layout with full-screen `#08090A` background; consistent visual with landing; `npm run build` exits 0, 70 pages generated
5. **SEO Structure** — `metadata` export with Open Graph + Twitter Card on public pages; `sitemap.ts` dynamic sitemap; `robots.ts` blocking private routes; JSON-LD `@graph` with Organization + WebSite + SearchAction schemas on landing
6. **SEO Config Panel** — `seo_config` Supabase table (RLS, service-role only, seeded default row); `getSeoConfig` / `updateSeoConfig` server actions; `/admin/seo` panel with `SeoConfigForm` (SEO-05, SEO-06)

**Archives:** [v2.6-ROADMAP.md](milestones/v2.6-ROADMAP.md) | [v2.6-REQUIREMENTS.md](milestones/v2.6-REQUIREMENTS.md)

---

## v2.4 CRM Expansion (Shipped: 2026-05-19)

**Stats:** 12 phases, 30 plans, 93 commits, 167 files, +31,256 / −31 lines
**Timeline:** 2026-05-18 (single-session marathon)
**Stack:** Next.js 16, Supabase (PostgreSQL + RLS + Realtime + Storage + Edge Functions), Deno, dnd-kit, Vitest

**Key accomplishments:**

1. **Accounts (Companies) entity** — `accounts` table (18 cols + RLS) with FK links from contacts/opportunities, `opp_has_contact_or_account` CHECK, idempotent data migration from `contacts.company`, full CRUD + merge + CSV import server actions (validated: ACC-01..19)
2. **Companies UI** — `/dashboard/accounts` list with 8-column table, debounced search, 5 filter dropdowns, bulk assign/tag/delete; `AccountCombobox` in contact form with inline quick-create; TopCompanies dashboard widget; `/dashboard/accounts/[id]` detail page with Contacts/Opportunities/Activities tabs, two-path opportunity creation, email-domain auto-suggest
3. **Custom Fields system** — `custom_field_definitions` table (20 cols, 13-type ENUM, 3-entity ENUM, per-entity reserved-key CHECK, RLS); pure-function validation lib (`validate.ts`, `serialize.ts`, `render-config.ts`) wired into all 3 entity server actions; settings page `/dashboard/settings/custom-fields` with drag-reorder (dnd-kit), groups, archive (validated: CF-01..15)
4. **Custom Fields rendering** — `CustomFieldsForm` + `CustomFieldsDisplay` wired into every contact/opportunity/account form and detail page; dynamic columns (`visible_in_list`) and type-aware filters (`filterable`) with jsonb `@>` operator; CSV import column mapping + CSV export with expanded custom-field columns
5. **Contact Import Pipeline** — `contact_imports` + `contact_import_errors` tables, Realtime publication, pg_cron 30-day cleanup cron, Storage bucket with per-org path RLS, `ContactImportStorage` + worker interfaces; 7-stage mapping wizard with direct-to-Storage XHR upload (signed URL, byte-level progress), heuristic auto-mapping, dedup picker, dry-run preview (validated: IMP-01..09, IMP-17..19)
6. **Import worker + history** — process-imports Deno Edge Function with chunked/cancellable execution, per-org cap (2) + global cap (8) via `SELECT FOR UPDATE SKIP LOCKED`, account auto-create on import, Realtime progress; `/dashboard/contacts/imports` list + detail pages, error CSV export, retry-failed flow (validated: IMP-10..16, IMP-20)

**Archives:** [v2.4-ROADMAP.md](milestones/v2.4-ROADMAP.md) | [v2.4-REQUIREMENTS.md](milestones/v2.4-REQUIREMENTS.md)

---

## v2.0 Multi-Bot Platform (Shipped: 2026-05-17)

**Phases completed:** 1 phases, 5 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.8 Executor Completeness (Shipped: 2026-05-08)

**Phases completed:** 9 phases, 26 plans, 43 tasks

**Key accomplishments:**

- (none recorded)

---

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

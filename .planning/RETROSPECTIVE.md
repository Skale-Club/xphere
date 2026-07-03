# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.4 — CRM Expansion

**Shipped:** 2026-05-19
**Phases:** 12 (64–75) | **Plans:** 35 | **Timeline:** 1 day (2026-05-18 → 2026-05-19, single-session)
**Stats:** 93 commits, 167 files, +31,256 / −31 lines

### What Was Built
- Accounts (Companies): `accounts` table + RLS + idempotent migration from `contacts.company`, full CRUD/merge/CSV-import server actions, list/detail UI with filters/search/bulk/tabs, email-domain auto-suggest
- Custom Fields: `custom_field_definitions` table (13 types × 3 entities), server-side zod validation, settings UI with dnd-kit reorder/groups/archive, type-aware form inputs and read-only display, dynamic list columns + filters, CSV IO
- Contact Import Pipeline: direct-to-Storage XHR upload (50MB/200k rows), 7-stage mapping wizard with heuristic auto-suggestions, dedup picker, dry-run preview, Deno Edge Function worker with concurrency caps + cancellation, Realtime progress, per-row error CSV export, retry-failed, account auto-create, imports history UI

### What Worked
- **Workstream isolation** — keeping v2.4 in `workstreams/v24-crm-expansion/` let phases 65 and 68 run in parallel without state conflicts; workstream pattern validated for multi-seed milestones
- **Phase sequencing** — the 3-seed fan-out (accounts → custom fields → import) kept dependencies clean: each seed's schema landed before UI phases that consumed it
- **Interface-first design for the worker** — defining `ContactImportStorage` and worker entry-point as interfaces before implementation made the Edge Function pluggable; swapping to Node/S3 post-Hetzner will touch only one file
- **Zod server-side validation** shared across 3 entity server actions from a single pure-function library — no code drift across contact/opportunity/account paths

### What Was Inefficient
- **Phases 71, 72, 74, 75 executed without formal PLAN.md files** — work was done directly in a worktree/agent session; GSD treated these phases as "pending" in the progress bar even though all summaries were `status: complete`. Adds friction at milestone-close time.
- **ROADMAP.md progress table not updated during execution** — phases 71–75 still showed "Not started" at archive time despite all being complete; required manual correction in the archived roadmap

### Patterns Established
- `SELECT FOR UPDATE SKIP LOCKED` pattern for queue-free import concurrency control — reusable for any future background processing without BullMQ/pg-boss
- Direct-to-Storage signed URL upload pattern (XHR + byte-level progress) avoids Vercel body size limits — template for future large-file features
- `CustomFieldsForm` + `CustomFieldsDisplay` pair as the standard rendering contract for metadata overlays

### Key Lessons
- When executing phases outside GSD's plan→execute flow (e.g., from a worktree agent), write PLAN.md stubs retroactively or the progress system stays confused
- Three seeds in one milestone is viable when they have a clear serial dependency chain; avoid parallel seeds that share schema writes in the same migration window

---

## Milestone: v1.0 — VoiceOps MVP

**Shipped:** 2026-04-03
**Phases:** 6 | **Plans:** 30 | **Timeline:** 4 days (2026-03-30 → 2026-04-03)

### What Was Built
- Multi-tenant foundation with Supabase RLS, auth, and org management
- Action Engine: Edge Function webhook → GHL execution → async logging (<500ms)
- Observability: call ingestion, paginated list, chat transcript with tool badges, dashboard metrics
- Knowledge Base: document upload → vectorization (OpenAI + pgvector) → semantic search during calls
- Outbound Campaigns: CSV import, Vapi dialing with cadence, Realtime contact status
- API Key Admin: per-org encrypted key management for 8 providers

### What Worked
- GSD phased planning kept scope tight — each phase had clear success criteria
- Edge Function architecture achieved <500ms target for Vapi webhook responses
- Supabase RLS-first approach prevented any multi-tenant data leaks by design
- Progressive phase dependencies (Foundation → Action Engine → Observability → Knowledge → Campaigns) meant each phase built on a stable base
- Per-org API key migration (Phase 6) was a clean refactor that touched many files but broke nothing

### What Was Inefficient
- ROADMAP.md progress table and REQUIREMENTS.md traceability were not updated as phases completed — caused stale tracking at milestone end
- VERIFICATION.md was never created for any phase — all verification was ad-hoc
- SUMMARY.md frontmatter `requirements_completed` arrays were mostly left empty
- Nyquist validation files were draft/incomplete for phases that had them, missing for others

### Patterns Established
- `get_current_org_id()` SECURITY DEFINER function as the single source of org context for RLS
- `after()` pattern for deferred async work in Edge Functions (logging, heavy processing)
- Belt-and-suspenders auth: middleware `getClaims()` + layout `getUser()` double-check
- `getProviderKey()` as unified interface for fetching encrypted per-org API keys
- Service-role client for bootstrap operations (org creation, bulk contact import)

### Key Lessons
1. Track requirement completion in SUMMARY.md frontmatter as you go — retroactive tracking is painful
2. Phase verification should happen immediately after execution, not deferred to milestone audit
3. Edge Function + `after()` pattern is excellent for Vapi's latency constraints — keep this for all webhook routes
4. Supabase RLS with SECURITY DEFINER functions is the right abstraction — simpler than application-level filtering

### Cost Observations
- Model mix: predominantly opus for planning, sonnet for execution
- 95 commits across 4 days
- Notable: Phase 6 (API key admin) was a single-plan phase that touched 9 files across 4 prior phases — clean cross-cutting refactor

---

## Milestone: v1.1 — Knowledge Base

**Shipped:** 2026-04-03
**Phases:** 4 (Data Layer, File Pipeline, URL Pipeline, UI & Wiring) | **Delivered as:** 1 atomic commit

### What Was Built
- LangChain `RecursiveCharacterTextSplitter` + `OpenAIEmbeddings` + `SupabaseVectorStore` replacing custom embedding logic
- Schema migration: `documents` → `knowledge_sources` tracking table + new `documents` table (LangChain-compatible)
- `match_documents` RPC for LangChain-compatible vector search with org_id metadata filter
- Per-org upload limits (5 files, 5 URLs) enforced server-side
- OpenAI-not-configured banner with gating on upload form
- shadcn AlertDialog replacing window.confirm() for deletes

### What Worked
- Single-commit delivery for a focused upgrade — no phase boundary overhead when scope is tight and well-understood
- LangChain abstraction made chunking/embedding/search code significantly cleaner than v1.0 raw pg calls
- Metadata-based org isolation (`metadata.org_id`) aligns with LangChain SupabaseVectorStore conventions perfectly

### What Was Inefficient
- GSD phase tracking wasn't used — ROADMAP phases had no plan/summary files, which broke `roadmap analyze` and `milestone complete`
- Migration push required manual workaround (Supabase dashboard) due to CLI account mismatch — not caught until end of work
- UAT was done via code audit rather than live app testing because migration wasn't pushed until end

### Patterns Established
- For small focused upgrades (<1 day, clear scope), inline delivery without formal GSD phases is acceptable — just record what was built in STATE.md
- Supabase CLI account must match project before starting DB migration work

### Key Lessons
1. Verify `npx supabase db push` access before writing migrations — CLI account mismatch is a silent blocker
2. LangChain's SupabaseVectorStore is the right abstraction for pgvector — don't re-implement what it already provides
3. Metadata-based org filtering (`metadata @> '{"org_id": "..."}'`) is cleaner than separate vector tables per tenant

### Cost Observations
- Single session, single commit delivery
- Notable: entire pipeline (schema + edge function + server actions + UI) delivered atomically with no rework

---

## Milestone: v1.2 — Operator + Embedded Chatbot

**Shipped:** 2026-04-05
**Phases:** 6 | **Plans:** 21 | **Commits:** 122 | **Timeline:** 2 days (2026-04-03 → 2026-04-05)

### What Was Built
- Brand rename: VoiceOps → Leaidear → Operator across all UI, nav, page titles
- Embeddable chat widget — single `<script>` / GTM, Shadow DOM CSS isolation, SSE streaming panel, localStorage session persistence
- Streaming AI conversation engine — SSE protocol, knowledge base pre-retrieval, action engine tool calls mid-stream
- Dual-memory architecture: Redis (active session) + Supabase `conversations`/`conversation_messages` (persistent history)
- Admin widget configuration — per-org name, color, welcome message, live preview, embed code, token regen
- Chat inbox — ConversationList, ChatArea, AdminChatLayout with dual polling; admin can read and reply

### What Worked
- Phase-gated approach meant widget Phase 4 could verify the exact asset built in Phase 2 without rework
- Shadow DOM isolation solved host-site CSS bleed completely without iframe complexity
- TDD-first RED scaffolds in Wave 0 caught API shape mismatches before implementation
- Dual-memory split (Redis session / Supabase persistence) is clean and fits Vercel Hobby constraints well
- Admin config storing widget settings on `organizations` table is simpler than a separate table and naturally RLS-scoped
- Phase 6 (chat inbox) scope expansion was smooth — added mid-milestone from a user spec without disrupting earlier phases

### What Was Inefficient
- INBOX-01..07 requirements were referenced in ROADMAP.md but never added to REQUIREMENTS.md — discovered only at milestone archive
- Brand rename happened in two steps (VoiceOps → Leaidear in Phase 1, Leaidear → Operator later) — could have been a single clean cut
- `resizable.tsx` needed a compatibility wrapper for react-resizable-panels v4 API — caught at runtime not at plan time
- Chat inbox polling uses setInterval rather than a proper subscription pattern — acceptable now but will need upgrading if volume increases

### Patterns Established
- Shadow DOM as the widget isolation strategy — prevents host-site CSS bleed, avoids iframe complexity
- `ReadableStream` + SSE `event: token` / `event: done` protocol for widget streaming
- Widget config stored on `organizations` table (not a separate entity) — works well for single-widget-per-org scope
- Denormalized `last_message`/`last_message_at` on `conversations` for inbox preview without aggregation queries
- esbuild IIFE pipeline for widget bundling — fast, zero-config, produces a single loadable file
- Phase scope expansions can be accommodated cleanly when they have a well-written CONTEXT.md from the start

### Key Lessons
1. If a Phase N adds requirements to ROADMAP.md, update REQUIREMENTS.md in the same commit — don't defer
2. Brand rename is highest risk for search-and-replace errors — do it once, in one phase, with a test that catches regressions
3. Human browser verification checkpoints (Phases 4, 5, 6) are worth the time — they caught real issues before milestone close
4. Widget embed architecture (Shadow DOM + IIFE + SSE) is a reusable pattern — document it once and reference in future chat phases

### Cost Observations
- 122 commits across 2 days — higher velocity than v1.0 (75 commits/day vs 24/day)
- 6 phases including one scope-expanded late addition (Phase 6)
- Notable: esbuild pipeline let widget code be TypeScript while producing vanilla JS — no webpack config overhead

---

## Milestone: v3.3 — Settings Nav Cleanup + Unified Templates

**Shipped:** 2026-07-03
**Phases:** 4 (122–125) | **Plans:** 6 | **Tasks:** 11 | **Timeline:** single session
**Stats:** 21 files changed, +1,039 / −112 lines (workstream `v33-unified-templates`, run fully autonomously end-to-end)

### What Was Built
- Removed the redundant "Call Center" Settings nav link and moved "Chat Widget" into Build
- Relocated the nav-orphaned WhatsApp templates screen to `/settings/whatsapp-templates` with name/status/category/language search+filter, dual-provider (Meta Cloud/Zernio) sync untouched
- New org-scoped `message_templates` table (migration 1233) + full CRUD UI at `/settings/message-templates` — generic quick-reply templates with per-channel SMS/Email/WhatsApp overrides, explicitly not a WhatsApp-Business-style approval workflow
- Live per-channel resolution preview tab in the Messages template editor, and the Settings "Communications" section renamed to "Templates" (Email Templates / Messages / WhatsApp Templates)

### What Worked
- **Deliberate phase sequencing around a known shared-file hazard** — all 4 phases touched `settings-sub-nav.tsx`; the roadmap explicitly ordered the nav-rename phase (125) last, after every real nav entry existed, instead of renaming a section with orphaned content
- **Heading-keyed, order-independent nav edits** — every phase's instruction to the planner was "find the section by heading, append an item" rather than a positional/literal-string edit, which meant 3 phases could safely mutate the same array even when they executed with real wall-clock overlap during autonomous execution
- **Explicit plan-checker cross-phase conflict checks** — before executing phases 123, 124, and 125, the plan-checker was explicitly asked to verify robustness against the other in-flight phases' edits to the same file, catching the hazard analytically before it could manifest as a race
- **True autonomous run** — the entire milestone (discuss → plan → verify plans → execute → verify goals → audit → complete → archive) ran with only two small AskUserQuestion batches (grey-area defaults for schema/UX shape), everything else proceeded without pausing, at the user's explicit request

### What Was Inefficient
- **Concurrent executors did race on STATE.md/ROADMAP.md/REQUIREMENTS.md** (not on code files) — three separate executor agents independently detected and self-reconciled a shared-file clobber on these bookkeeping docs mid-run. No code or requirement tracking was lost, but each executor spent extra turns re-applying its own edits. A future improvement: serialize just the bookkeeping-file writes (e.g. a single orchestrator-side update after each executor returns) instead of letting every parallel executor write them directly
- **Stale `.next` build-cache lock contention** — running 2-3 executors in the same working tree caused repeated `npm run build` retries due to Windows file-lock contention on the shared `.next` directory; cost extra wall-clock time per phase but never caused an incorrect pass/fail verdict

### Patterns Established
- "Key by heading/id, not position" as the standard instruction for any plan that mutates a shared static config array also touched by sibling phases in the same milestone
- Explicit "cross-phase file conflict check" as a named, first-class ask to the plan-checker whenever a roadmap enumerates more than one phase touching the same file

### Key Lessons
- When a milestone's roadmap flags multiple phases as mutually independent ("Depends on: Nothing") but they in fact share a file, that shared-file risk needs to be surfaced explicitly to both the planner and the plan-checker — "no phase dependency" is not the same as "no file conflict"
- Running phases genuinely in parallel (not just planning-in-parallel) is viable for small, additive, heading/id-keyed edits to shared config files, but bookkeeping docs (STATE/ROADMAP/REQUIREMENTS) need either serialization or a reconcile-before-commit habit to avoid churn

### Cost Observations
- Single session, fully autonomous after initial requirements-gathering
- Heavy use of parallel subagents (up to 3 executors + verifiers concurrently) to compress a 4-phase, 6-plan milestone into one continuous run

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Timeline | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 4 days | 6 | Initial build — established all patterns |
| v1.1 | 1 session | 4 (inline) | LangChain upgrade — single atomic delivery |
| v1.2 | 2 days | 6 | Widget + chat inbox — TDD RED scaffolds, human verification checkpoints |

### Cumulative Quality

| Milestone | Tests | Todo Stubs | Audit Score |
|-----------|-------|------------|-------------|
| v1.0 | 38 passing | 132 todos | 42/42 req wired |
| v1.1 | 10/10 UAT | — | Code audit pass |
| v1.2 | Wave 0 RED → green per phase | — | 21/21 plans + 3 human browser checkpoints |

### Top Lessons (Verified Across Milestones)

1. Track requirements completion incrementally — not at milestone end
2. RLS-first multi-tenancy prevents entire categories of bugs
3. Human browser verification checkpoints catch real issues that unit tests miss — include for any user-facing UI phase
4. Shadow DOM for embedded widgets is the right isolation primitive — avoid iframes unless sandboxing is needed

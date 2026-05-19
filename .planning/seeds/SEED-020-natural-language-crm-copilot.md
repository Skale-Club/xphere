---
id: SEED-020
status: dormant
planted: 2026-05-19
enriched: 2026-05-19 (after analyzing Vercel Chatbot template v3.1 / AI SDK 6 patterns)
planted_during: post-SEED-019 Visual Automation Builder Phases A–D
research: null
reference_implementations:
  - "Vercel Chatbot template (chat.vercel.ai) — github.com/vercel/ai-chatbot — AI SDK 6, resumable streams, artifacts, generative UI"
trigger_when: explicit user request OR milestone planning with theme "AI copilot", "chat with your CRM", "natural language CRM", "Notion/Linear AI copy", "operator productivity"; OR users start treating the AI builder chat as a general-purpose CRM assistant; OR competitor (Attio AI, HubSpot Breeze, Salesforce Einstein) ships a comparable feature
scope: Large
priority: high
depends_on: [SEED-019 (flow builder — tool-use pattern, BYOK plumbing, action-engine substrate)]
---

# SEED-020: Natural-Language CRM Copilot — Bring Your Own Key

Build a **chat-based CRM copilot** that can read, mutate, and reason over **every CRM entity** in Xphere (contacts, accounts, opportunities, tasks, notes, bookings, custom fields, tags, activities, email templates, calls, reviews) through structured tool calls against the operator's own API key.

The defining principle: **the operator chats with the database.** "Show me the 10 contacts most likely to close this week", "Move all hot leads from Wagner's account to Qualified", "Create a follow-up task for everyone who opened the Black Friday email and didn't reply", "Summarize this week's calls by sentiment", "Find duplicate contacts and merge them" — all expressed in plain Portuguese or English, all executed via tool calls that respect RLS and the operator's permissions.

Bring Your Own Key (BYOK): the operator connects OpenRouter, Anthropic, or OpenAI under `/integrations`. Xphere pays nothing for inference; the operator chooses model, controls spend, and owns the data path. Same credential plumbing already shipped for the flow AI builder.

Conceptually inspired by Attio AI, Notion AI, Linear's natural-language search, and HubSpot Breeze. Differentiated by: (1) BYOK so the platform doesn't subsidize inference, (2) reuse of the existing action-engine + RLS + custom-fields stack as the tool layer, (3) one copilot panel that sits over the entire dashboard, not per-page bolted-on AI features.

---

## Why This Matters

### 1. Operators don't want to navigate, they want to ask
The dashboard has ~15 entity pages (contacts, accounts, pipeline, tasks, notes, bookings, custom fields, tags, agents, integrations, knowledge, calls, reviews, members, scheduling). A new operator burns weeks learning where each control lives. A power operator still pays a small navigation tax on every action: *"open contacts, filter by tag, multi-select, bulk action, confirm"* becomes *"add tag 'reactivated' to all contacts who haven't been called in 90 days"* in one sentence.

Notion AI, Linear's Cmd+K AI, Attio AI, and HubSpot Breeze are all converging on the same UX: an always-available chat panel that can do anything the UI can do, but faster. Xphere already has the tools (action-engine), the schema (custom fields + RLS), and the AI plumbing (flow builder Phase C). Wiring them into a CRM-scoped copilot is a small lift on top of work already shipped.

### 2. AI is a UX layer, not a feature
Every entity page today is essentially: *fetch + filter + paginate + display + bulk actions*. The copilot turns that into: *fetch + filter + paginate + summarize + act*. The same data; a different surface. Operators with thousands of contacts get this most:
- "Which contacts haven't been touched in 30 days?" → list + offer bulk action
- "Why is this opportunity stalled?" → reads activities, notes, tasks; offers next-best-action
- "Compare conversion rate between Wagner's deals and Marina's deals last month" → aggregates pipeline data

These are queries operators currently solve with SQL, exports to spreadsheets, or *"I'll come back to that"*. The copilot makes them one-shot.

### 3. BYOK is the right business model
Inference costs grow linearly with usage. Bundling it into the platform forces Xphere to subsidize heavy users (10× more chat calls than a typical user) at the cost of light users. BYOK aligns incentives:
- Operator brings their OpenRouter / Anthropic / OpenAI key
- Xphere never holds inference costs, so unlimited copilot usage is free
- Operator picks the model trade-off: GPT-4 quality vs Haiku speed vs Sonnet balance
- Different orgs can use different providers (compliance, regional latency, budget)

The plumbing already exists — the flow AI builder uses the same pattern (`getProviderKey('openrouter', orgId, supabase)` first, Anthropic fallback). The copilot reuses it.

### 4. The action-engine is the substrate
We already have `src/lib/action-engine/execute-action.ts` dispatching tool calls to provider executors. Many CRM mutations are already action types (create_contact, create_task, knowledge_base, send_whatsapp). The copilot just adds:
- A larger toolset (50–80 read+write tools covering every CRM entity)
- A chat panel UI
- Multi-turn tool-use loop (already proven by the flow builder Phase C)
- Variable interpolation / context retention across turns
- A handful of read-only "query" tools that don't fit the action-engine shape (list_contacts, query_pipeline, etc.)

### 5. RLS is the security model — no parallel auth layer
Every query the copilot issues goes through the authenticated Supabase client, which enforces RLS via `get_current_org_id()`. The copilot literally cannot see another org's data — the policies do that. No special "AI safety layer" needed, because the existing tenant isolation IS the safety layer. Compare this to platforms that retrofit AI: they end up building a parallel permission system because their AI bypasses the normal access path.

---

## When to Surface

**Primary triggers:**
- Explicit user request for an AI assistant / CRM copilot / "chat with the CRM" feature
- Milestone planning with theme "AI productivity", "operator copilot", "natural language interface"
- Operators in user research describe a common pain as *"I have to click through too many screens to find / change / report on X"*
- Competitor analysis: Attio AI, Notion AI, HubSpot Breeze, or Salesforce Einstein push parity into a sales conversation

**Secondary triggers:**
- The flow AI builder's chat panel starts getting used as a general assistant — clear signal operators want broader scope
- First request for natural-language reporting ("Why did revenue drop last week?")
- A new entity (e.g. invoices, products) is added and the operator wants AI awareness from day one

**Negative triggers (don't surface):**
- Milestone focused on a single integration or webhook — copilot adds no value there
- Customer base hasn't yet validated that the existing CRM surface is the bottleneck (e.g. early-stage org with 50 contacts and no daily ops)

---

## Recommended Stack (mostly reused + AI SDK 6 patterns from Vercel Chatbot)

| Layer | Pick | Rationale |
|-------|------|-----------|
| **Framework** | **AI SDK 6 (`ai@^6`)** with `streamText` + `createUIMessageStream` + `tool()` factory | Battle-tested in Vercel Chatbot template v3.1; replaces raw OpenAI/Anthropic SDK calls. Native multi-step (`stopWhen: stepCountIs(N)`), typed tools, streaming UI parts |
| **AI transport** | Existing BYOK pattern: AI SDK with `@ai-sdk/openai` `createOpenAI({ baseURL: 'openrouter.ai/api/v1', apiKey: orgKey })` OR `@ai-sdk/anthropic` native | Replaces the raw `OpenAI` SDK calls in `ai-build.ts` with AI SDK's provider abstraction. Same `getProviderKey` resolution; cleaner streaming API |
| **Tool schema** | AI SDK `tool({ description, inputSchema: z.object(...), execute: async ({...}) => {...} })` | One canonical shape; AI SDK handles translation to provider-native formats automatically |
| **Tool dispatch** | New `src/lib/copilot/tools/` directory: ~6 modules (contacts, accounts, pipeline, tasks-notes, scheduling, email) each exporting `Record<string, Tool>` (named export per tool) | Modular; AI SDK lets you pass `tools: { ...contactTools, ...accountTools, ... }` directly to `streamText` |
| **Resumable streams** | **`resumable-stream` package + Redis** (same pattern as Vercel Chatbot) | Operator launches a 10-step query, closes laptop, comes back — stream resumes. `REDIS_URL` already configured in env |
| **Streaming UI events** | AI SDK 6 `dataStream.write({ type: 'data-entity-card', data, transient: true })` typed parts | Tools push custom UI events (entity cards, charts, confirmation widgets) mid-stream. Frontend `data-stream-handler.tsx` listens by type. Same pattern flow builder uses for canvas mutations |
| **UI components** | **`ai-elements` shadcn registry** (`npx shadcn add https://registry.ai-sdk.dev/...`) — Conversation, Message, MessageContent, etc. | Don't roll our own chat bubbles. Vercel-maintained, accessible, matches shadcn primitives already in tree |
| **Auth** | Existing `createClient()` from `@/lib/supabase/server` — every query auto-scoped by RLS | No new permission layer |
| **State** | Zustand store: `copilot-store.ts` — conversation history, active turn, context (current entity if launched from a detail page) | Mirrors flow-store pattern |
| **Chat panel** | Slide-over Sheet triggered by global `Cmd+K` (or `/`) shortcut + floating AI button | shadcn `Sheet` already used elsewhere |
| **Streaming smoothing** | `experimental_transform: smoothStream({ chunking: 'word' })` from AI SDK | Word-by-word streaming, smoother than raw token output |
| **Multi-turn cap** | `stopWhen: stepCountIs(12)` (AI SDK native) | Replaces manual loop counter; cleaner than what flow builder does today |
| **Tool filtering per turn** | `experimental_activeTools: [...]` per request | Lets us disable destructive tools by default, require explicit "enable write mode" toggle |
| **Citation / source** | Every "answer" that quotes data includes inline links via markdown (`<a href="/contacts/abc-123">João Silva</a>`) | `ai-elements` Message component renders markdown out of the box |
| **Memory** | Per-conversation only at v1. Cross-session memory deferred — operators don't trust it yet anyway | Avoid the "AI remembers wrong things" footgun |
| **Telemetry** | `experimental_telemetry: { isEnabled: isProductionEnvironment, functionId: 'copilot-turn' }` | OpenTelemetry traces in prod; debug slow tool chains via Vercel observability |
| **Bot protection** (if any public endpoint) | Skip — copilot is auth-only, RLS-scoped | Vercel Chatbot uses `botid/server` for public-facing chat; not needed for our authenticated copilot |

### Why upgrade to AI SDK 6 (vs. raw provider SDKs)

The flow builder currently uses raw OpenAI / Anthropic SDKs in a manual tool-use loop. That works but is ~200 lines of orchestration code. AI SDK 6 replaces it with:

```ts
const result = streamText({
  model: getCopilotModel(orgId), // BYOK resolved
  system: buildSystemPrompt({ currentEntity, locale }),
  messages: modelMessages,
  tools: { ...contactsTools, ...accountsTools, ...pipelineTools, ... },
  stopWhen: stepCountIs(12),
  experimental_activeTools: writeMode ? allToolNames : readOnlyToolNames,
  experimental_transform: smoothStream({ chunking: 'word' }),
  experimental_telemetry: { isEnabled: isProductionEnvironment },
});
```

That's the entire loop. AI SDK handles: streaming, tool-call extraction, multi-turn iteration, message conversion, provider translation. The flow builder Phase C can also be refactored to use this (post-v1).

---

## Locked Decisions

| Decision | Value | Reasoning |
|----------|-------|-----------|
| Model defaults | OpenRouter → `anthropic/claude-sonnet-4.5`; Anthropic native → `claude-sonnet-4-6` | Matches flow builder defaults; Sonnet is the sweet spot for tool-use + reasoning |
| BYOK enforcement | No platform fallback in production. Dev only: `ANTHROPIC_API_KEY` env var | Aligns costs with usage; forces clear UX when key is missing |
| Tool granularity | Read tools return ≤ 50 rows by default; write tools take explicit IDs (never bulk-by-filter for destructive ops in v1) | Prevent "delete all contacts where..." disasters at v1 |
| Read vs write split | Tool names prefixed by intent: `query_contacts`, `update_contact`, `create_task`, `delete_note` | Self-documenting; future per-role permission gates can filter by prefix |
| Destructive op confirmation | Any `delete_*` or bulk `update_*_bulk` requires a confirmation token in the same turn ("type CONFIRM to proceed") emitted by AI; reviewed by user before tool fires | Avoid runaway model hallucinations affecting prod data |
| Multi-turn limit | 12 tool calls per user turn (vs flow builder's 10) | CRM workflows often need: query → analyze → mutate → verify chain |
| Context awareness | If launched from `/contacts/abc-123`, the first system message includes `current_entity: { type: 'contact', id: 'abc-123' }` | Saves the operator from re-stating context |
| Citation format | Markdown links to entity URLs; AI is system-prompted to always include them when referencing specific rows | Operator can click through to verify |
| Audit log | Every tool call writes to a new `copilot_runs` + `copilot_tool_calls` table (org-scoped RLS, mirrors `workflow_runs`) | Observability + compliance + debugging "what did the AI do today" |
| Cost telemetry | Every call records input/output tokens + estimated cost in USD into `copilot_runs` | Operator can see their own spend; surfaces "expensive prompts" |
| Privacy | LLM provider gets the entity data needed for the query; no PII redaction at v1 (operator's own key, their own choice) | BYOK = operator owns the privacy decision |
| Rate limit | Per-org: 60 calls/minute soft cap; hard 200/minute. Rejects with friendly toast | Protect against runaway loops |
| Fallback behavior | If both OR/Anthropic keys missing in prod: copilot panel shows "Connect OpenRouter or Anthropic in Integrations" with a CTA | Same UX pattern as flow builder |
| Custom fields | Copilot can read + write custom_field_definitions and contact/opportunity/account custom_fields JSONB | Operators define the schema once and copilot uses it |
| Conversation persistence | Sessions stored in `copilot_conversations` (id, org_id, created_by, title, started_at) + `copilot_messages` (role, content, tool_calls, timestamps) | Operator can revisit "what did I ask yesterday" |

---

## Scope Estimate

**Large.** Realistic v1 fits a **4-phase / ~5-week milestone**, similar shape to SEED-019:

- **Milestone A — v3.1 (this seed):** copilot panel, contacts + accounts + pipeline + tasks + notes tool layer, BYOK resolution, audit log, conversation persistence
- **Milestone B — v3.2:** scheduling + email marketing tools, bulk actions with confirmation flow, custom-field-aware querying
- **Milestone C — v3.3:** cross-session memory, suggested prompts (per page), saved "ask templates", AI-generated dashboards / reports

### Milestone A — Phase decomposition (updated with AI SDK 6 patterns)

**Phase A — Foundation (1 week)**
- Install: `ai@^6`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/react`, `resumable-stream`
- Install ai-elements: `npx shadcn add https://registry.ai-sdk.dev/conversation` + message + reasoning
- Migration: `copilot_conversations`, `copilot_messages` (with `parts` JSONB), `copilot_runs`, `copilot_tool_calls`, `copilot_streams` (RLS, indexes, FK to organizations)
- BYOK resolver `src/lib/copilot/resolve-provider.ts` — returns AI SDK provider instance configured with org's key (extracted from `ai-build.ts`; flow builder refactors to use same helper)
- Tool registry `src/lib/copilot/tools/index.ts` — collects `Record<string, Tool>` from all domain modules
- Server action `runCopilotTurn({ conversationId, userMessage, currentEntity?, writeMode? })` — uses `streamText` + `createUIMessageStream` + `stopWhen: stepCountIs(12)`
- API route `/api/copilot/stream` — Vercel Fluid Compute, returns `createUIMessageStreamResponse` with resumable stream registration
- Two-layer rate limit: per-user (60/hr soft) + per-IP (200/hr hard)

**Phase B — Read tools (1 week)**
- `src/lib/copilot/tools/contacts.ts` — `query_contacts` (filter, sort, paginate, max 50 rows), `get_contact`, `list_recent_contacts`, `find_duplicate_contacts`
- `src/lib/copilot/tools/accounts.ts` — `query_accounts`, `get_account`, `list_account_contacts`
- `src/lib/copilot/tools/pipeline.ts` — `query_opportunities` (by stage/owner/value), `get_opportunity`, `list_recent_activity`, `summarize_pipeline_health`, `identify_stalled_opportunities`
- `src/lib/copilot/tools/tasks_notes.ts` — `query_tasks`, `query_notes`, `get_task`, `get_note`
- `src/lib/copilot/tools/custom_fields.ts` — `list_custom_fields`, `get_entity_custom_fields`, `search_by_custom_field`
- Each module: `tool({ description, inputSchema: z.object(...), execute })` factory; RLS-scoped Supabase queries; LLM-token-budget-optimized response shapes
- Domain-specific system prompt blocks composed into the master prompt
- Read-only mode is the default — these tools are always available

**Phase C — Write tools + UI (1.5 weeks)**
- Write tools for the same 5 domains: create / update / delete (delete + bulk-update require button-based approval flow, not literal "CONFIRM" text)
- Tool approval flow: AI emits `data-confirmation` stream part → frontend renders button → user clicks → frontend re-sends history with `isToolApprovalFlow = true`
- `experimental_activeTools` filters write tools out unless `writeMode: true` is passed
- Copilot slide-over Sheet component `src/components/copilot/copilot-sheet.tsx` (uses ai-elements `Conversation` + `Message` primitives)
- Floating launcher button in app shell + global `Cmd+K` shortcut
- Write-mode toggle in sheet header (✏ icon, persists per session)
- `data-stream-handler.tsx` — listens for `data-entity-card`, `data-tool-call`, `data-confirmation`, `data-cost-update` events
- Page-context awareness — when on a detail page, the panel auto-includes `current_entity` in system prompt
- Greeting component with 4 hand-curated suggested prompts per page (contacts page → "find duplicates" / etc.)
- `smoothStream({ chunking: 'word' })` for streaming UX

**Phase D — Polish + Observability (1 week)**
- Resumable streams enabled (`resumable-stream` + Redis registration)
- Conversation history view `/copilot/conversations` (list + per-conversation replay)
- Per-run debug view at `/copilot/runs/[id]` — prompt, every tool call's input/output, token + cost breakdown
- Cost telemetry display in panel header ("~$0.04 this session" badge)
- Cost ceiling: per-org soft cap with warning toast at threshold
- Master system prompt + few-shot library covering 20 archetypal CRM tasks
- `experimental_telemetry` enabled in production
- Vitest tests for each tool (mocked Supabase) + integration tests using `ai/test` `MockLanguageModelV1`
- Documentation: tool-authoring guide; "what the copilot can do" page

**Optional (if scope allows) — Artifacts in v1:**
- `pipeline_report` artifact kind — AI generates a side-panel report
- `contact_csv` artifact kind — AI generates a downloadable filtered export
- Pattern: copy Vercel chatbot's `artifacts/text/server.ts` + `createDocumentHandler` shape

**Total:** ~5 weeks with buffer. Optional artifacts add 0.5 week.

### Database schema (Phase A)

```sql
copilot_conversations (
  id uuid pk, org_id uuid, title text, started_at, ended_at,
  created_by uuid, created_at, updated_at
)

copilot_messages (
  id uuid pk, conversation_id uuid fk,
  role text,                  -- 'user' | 'assistant' | 'tool'
  content text,
  tool_call_id text,          -- for role='tool'
  tool_name text,             -- for role='tool'
  metadata jsonb,             -- provider, model, finish_reason, tokens
  created_at
)

copilot_runs (
  id uuid pk, org_id uuid, conversation_id uuid fk,
  provider text,              -- 'openrouter' | 'anthropic'
  model text,
  input_tokens int, output_tokens int,
  estimated_cost_usd numeric(10,4),
  status text,                -- 'running' | 'succeeded' | 'failed'
  error text,
  started_at, ended_at, created_at, created_by uuid
)

copilot_tool_calls (
  id uuid pk, run_id uuid fk,
  tool_name text, input jsonb, output jsonb, error text,
  status text,                -- 'succeeded' | 'failed'
  duration_ms int,
  created_at
)
```

### Tool surface (v1 target — Phases B + C)

**Contacts** (8 tools): query_contacts, get_contact, create_contact, update_contact, delete_contact, add_contact_tag, remove_contact_tag, find_duplicate_contacts

**Accounts/Companies** (5 tools): query_accounts, get_account, create_account, update_account, list_account_contacts

**Pipeline / Opportunities** (8 tools): query_opportunities, get_opportunity, create_opportunity, update_opportunity, move_to_stage, list_recent_activity, summarize_pipeline_health, identify_stalled_opportunities

**Tasks** (6 tools): query_tasks, get_task, create_task, update_task, complete_task, delete_task

**Notes** (4 tools): query_notes, get_note, create_note, pin_note

**Custom fields** (4 tools): list_custom_fields, get_entity_custom_fields, set_entity_custom_field, search_by_custom_field

**Total v1:** ~35 tools across 6 domains. Phase B ships read-only (~17 tools), Phase C ships writes (~18 tools).

### Components to build

**Backend:**
- `src/lib/copilot/resolve-provider.ts` — BYOK resolution (extracted from ai-build.ts; both copilot and flow builder use it)
- `src/lib/copilot/registry.ts` — central tool collection + OpenAI translation
- `src/lib/copilot/dispatch.ts` — generic dispatcher
- `src/lib/copilot/tools/*.ts` — 6 domain modules, each exporting `Tool[]` + per-tool handlers
- `src/lib/copilot/system-prompt.ts` — master prompt + domain prompt blocks + few-shot examples
- `src/lib/copilot/stream.ts` — SSE streaming for the chat panel
- `src/lib/copilot/cost.ts` — token → USD estimation per model (pricing table)
- `src/app/(dashboard)/copilot/_actions/conversations.ts` — list, get, delete conversations
- `src/app/(dashboard)/copilot/_actions/runs.ts` — get run + tool calls for debug view
- `src/app/api/copilot/stream/route.ts` — Vercel Fluid Compute streaming endpoint

**Frontend:**
- `src/components/copilot/copilot-sheet.tsx` — slide-over panel
- `src/components/copilot/launcher.tsx` — floating button + `/` shortcut handler (added to app shell)
- `src/components/copilot/message-bubble.tsx` — markdown + entity citation rendering
- `src/components/copilot/tool-call-block.tsx` — collapsible inline "AI called query_contacts {...} → 23 results"
- `src/components/copilot/confirm-prompt.tsx` — destructive op confirmation widget
- `src/components/copilot/cost-badge.tsx` — running total of session spend
- `src/stores/copilot-store.ts` — Zustand store (mirrors flow-store)
- `src/app/(dashboard)/copilot/conversations/page.tsx` — conversation history list
- `src/app/(dashboard)/copilot/runs/[id]/page.tsx` — single-run debug view

### Out of scope (deferred to Milestones B and C)

- **Scheduling tools** — book / cancel / list bookings via natural language (Milestone B)
- **Email-marketing tools** — generate / send email from template (Milestone B)
- **Knowledge-base awareness** — RAG over uploaded docs as a tool (Milestone B; existing knowledge stack already used by `query-knowledge.ts`)
- **Call summarization** — "summarize last week's calls by sentiment" (Milestone B)
- **Bulk update by filter** — "tag all contacts created last week as 'q3-leads'" with safety guards (Milestone B; v1 forces ID lists)
- **Cross-session memory** — copilot remembers preferences across sessions (Milestone C)
- **AI-generated dashboards** — "show me a weekly pipeline health report" rendered as charts (Milestone C)
- **Operator-defined macros** — save a chat sequence as a reusable "ask template" (Milestone C)
- **Voice input / output** — copilot via mic, TTS responses (Milestone C; or never)
- **Multi-org context switching** — copilot only sees the active org, no cross-org queries (intentional, RLS enforces)

---

## AI Tool-Calling Pattern (reused from SEED-019)

This is the exact pattern proven in the flow AI builder Phase C:

1. **One canonical schema, two transports.** Tools defined as Anthropic `Tool[]` in `src/lib/copilot/tools/*.ts`. The OpenRouter path translates them via the same helper used in `ai-build.ts` — `toOpenAiTools()`.

2. **BYOK resolution.** `resolveProvider(orgId)`: OpenRouter key first, Anthropic next, env-var Anthropic last (dev only).

3. **Multi-turn loop.** Up to 12 tool calls per user turn (vs flow builder's 10 — CRM tasks chain more). Each turn: model → tool calls → dispatch + persist to `copilot_tool_calls` → tool results back to model → repeat until text-only response or limit.

4. **Streaming.** OpenAI SDK streaming chunks (`p.emit({ event: 'token', text: ... })`) flow through SSE to the panel for token-by-token rendering. Tool calls emit `{ event: 'tool_call', name, status }` events that render as collapsible blocks in the message stream.

5. **Citations enforced by system prompt.** The master prompt instructs: *"Whenever you reference a specific contact, account, opportunity, task, or note, always include a markdown link to its detail page."* AI compliance is enforced by including a `validate_response` post-check that rejects responses without citations when entities were referenced.

6. **Confirmation for destructive ops.** Tool schema for `delete_contact`, `delete_account`, etc. includes a `confirm_token` required parameter. The AI must first ask the user in plain language *"This will delete contact X. Type CONFIRM to proceed."*, wait for the user to reply with "CONFIRM", and only then call the tool with `confirm_token: 'CONFIRM'`. The dispatcher rejects calls without the literal token.

7. **Cost telemetry per call.** Every model response carries `usage.input_tokens` + `usage.output_tokens`. The dispatcher consults the per-model pricing table (`src/lib/copilot/cost.ts`) and writes USD estimate to `copilot_runs`. Operator sees a running session badge: `~$0.07 this session`.

8. **Auditable.** Every conversation, every run, every tool call lands in the database with timestamps, inputs, outputs, durations, errors. The debug view `/copilot/runs/[id]` is essentially a flight recorder for "what did the AI do".

9. **Tool-author guide.** Future contributors adding a tool to a domain module follow a 10-line template: Zod input schema, Anthropic `Tool` definition, async handler `(input, ctx) => result`. Registered in the domain's `index.ts` export. Picked up automatically by `registry.ts`.

10. **Master system prompt enforces simplicity.** *"Don't ask 5 clarifying questions before acting. Make the best inference, act, and explain. The user can always undo."* *"Don't fabricate IDs. If you don't know, query first."* *"Keep responses under 200 words unless asked for detail."*

---

## Patterns Borrowed from Vercel Chatbot Template (v3.1, AI SDK 6)

The Vercel chatbot template at `chat.vercel.ai` ([github.com/vercel/ai-chatbot](https://github.com/vercel/ai-chatbot)) is the most polished open-source reference for AI SDK 6. Audit of its `app/(chat)/api/chat/route.ts` + tools surfaced these patterns worth adopting:

### 1. **Resumable streams — `resumable-stream` package**

```ts
import { createResumableStreamContext } from 'resumable-stream';

const streamContext = createResumableStreamContext({ waitUntil: after });
const streamId = generateId();
await createStreamId({ streamId, chatId: id });
await streamContext.createNewResumableStream(streamId, async () => stream);
```

**Why this matters for copilot:** operator runs *"find all stalled deals and create follow-up tasks for each"* → 10 tool calls, 30 seconds. User closes the tab. Comes back: stream picks up where it left off. Same Redis we already use for chat sessions.

### 2. **Artifacts — extensible "side panel" outputs**

The Vercel chatbot has 4 artifact kinds: `text`, `code`, `image`, `sheet`. Each is a tool (`createDocument`, `updateDocument`) that streams content into a side panel while the chat continues in the main view.

**Apply to SEED-020 (Milestone C):** add CRM artifact kinds:
- `pipeline_report` — AI generates a stage-by-stage health table with stalled-deal callouts
- `contact_csv` — AI generates a filtered contact export as a downloadable artifact
- `dashboard` — AI generates a chart/table dashboard for the question being asked
- `email_draft` — AI drafts an email template that the operator can edit before sending

Pattern: copilot answers *"Show me Q3 pipeline health"* in the chat with a one-paragraph summary, AND opens a `pipeline_report` artifact in the side panel with the data table + chart. Click-through to entity pages from the artifact.

### 3. **Generative UI via typed `data-*` stream parts**

Tools write custom events into the stream:

```ts
dataStream.write({ type: 'data-entity-card', data: { id, type: 'contact' }, transient: true });
dataStream.write({ type: 'data-confirmation', data: { action: 'delete', target: id } });
dataStream.write({ type: 'data-pipeline-chart', data: chartData });
```

Frontend `data-stream-handler.tsx` listens by type and renders rich components inline with the chat. Same generative-UI pattern as v0 — but for CRM data.

**Copilot data types to support at v1:**
- `data-entity-card` — inline card preview when AI references a contact/account/opportunity (more than just a link)
- `data-tool-call` — collapsible "AI called query_contacts({status: 'lead'}) → 23 results" block
- `data-confirmation` — destructive op confirmation widget (button-based, not "type CONFIRM")
- `data-cost-update` — running session cost badge update

### 4. **Message persistence with `parts` JSONB**

Vercel chatbot stores messages as:

```ts
{
  id, chatId, role,
  parts: jsonb,        // [{ type: 'text', text: '...' }, { type: 'tool-call', toolName, args, result }, ...]
  attachments: jsonb,  // file references
  createdAt
}
```

The `parts` array preserves the exact tool-call sequence (tool name, input, output) inline with the assistant message. Replay is lossless.

**Replaces my SEED-020 schema's separate `tool_call_id` / `tool_name` columns** — parts pattern is cleaner. Updated schema in the section below.

### 5. **Tool approval flow (better than literal "CONFIRM")**

Vercel chatbot pattern: when the model wants to confirm something, it streams a `data-confirmation` event with the action + target. The frontend renders a button. User clicks "Confirm" → frontend re-sends the full message history with `isToolApprovalFlow = true`. The model sees the approval and proceeds with the actual tool call.

```ts
const isToolApprovalFlow = Boolean(messages);
const uiMessages = isToolApprovalFlow ? messages : [...convertToUIMessages(messagesFromDb), message];
```

**Updates my "type CONFIRM" decision:** use buttons + flow re-entry, not literal text. Better UX, works with voice input too.

### 6. **Two-layer rate limiting**

```ts
await checkIpRateLimit(ipAddress(request));               // per-IP
const messageCount = await getMessageCountByUserId({ id, differenceInHours: 1 });
if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) ...;  // per-user
```

**For copilot:** per-user soft cap (60/hr) + per-IP hard cap (200/hr) + per-org spend cap ($X/day from cost telemetry). Three layers.

### 7. **`stopWhen: stepCountIs(N)` from AI SDK**

Replaces manual loop counters. Clean, declarative, capped.

### 8. **`experimental_activeTools` for per-turn tool filtering**

```ts
experimental_activeTools: writeMode
  ? Object.keys(allTools)
  : Object.keys(allTools).filter(name => name.startsWith('query_') || name.startsWith('get_'))
```

**New decision: default to read-only mode.** Operator toggles "✏ Enable write mode" in the panel header to expose write tools. Reduces the blast radius of an early-session misclick. Write mode persists per session.

### 9. **Geolocation context auto-injected**

Vercel chatbot passes `geolocation(request)` into the system prompt. For Xphere copilot, equivalent is: pass `current_entity` (if launched from a detail page) and `active_org_id` + `user_locale` into the system prompt automatically.

### 10. **AI Gateway as optional fallback (alternative to BYOK)**

The Vercel chatbot uses Vercel's hosted AI Gateway by default. For Xphere, we can offer:
- **Primary path:** BYOK (operator's OpenRouter / Anthropic key) — free for Xphere
- **Optional fallback:** Vercel AI Gateway — Xphere fronts the cost, charges a per-seat upgrade

This makes the copilot accessible to operators who don't want to manage API keys, while preserving BYOK as the default. Pricing TBD; out of scope for v1 but worth noting.

### 11. **AI SDK 6 testing primitives**

`models.mock.ts` + `models.test.ts` in the Vercel chatbot show how to mock providers for Vitest. Reuse for copilot integration tests:

```ts
import { simulateReadableStream } from 'ai/test';
import { MockLanguageModelV1 } from 'ai/test';
```

**Adds:** unit tests for each tool dispatcher + integration tests for multi-turn flows with mock provider responses.

### 12. **`smoothStream({ chunking: 'word' })` for streaming UX**

Prevents the LLM output from appearing in awkward token chunks. Word-by-word feels conversational.

### 13. **`onFinish` callback for persistence**

```ts
onFinish: async ({ messages: finishedMessages }) => {
  await saveMessages({ messages: finishedMessages.map(...) });
}
```

Persists final message state to DB once the stream completes. Replaces ad-hoc try/finally persistence in raw SDK code.

### 14. **Greeting + suggested actions** (the empty state)

Vercel chatbot shows a `<Greeting />` component when the chat is empty: title + 4 suggested prompts. **For copilot:** context-aware suggestions based on the page:
- On `/contacts` empty chat: "Find duplicate contacts" / "Show contacts not touched in 30 days" / "Tag all leads from last week"
- On `/pipeline` empty chat: "Summarize this week's pipeline health" / "Identify stalled deals" / "Compare conversion by owner"
- Anywhere: "Search across everything"

### 15. **Don't reinvent UI primitives — use `ai-elements`**

```bash
npx shadcn add https://registry.ai-sdk.dev/conversation
npx shadcn add https://registry.ai-sdk.dev/message
npx shadcn add https://registry.ai-sdk.dev/reasoning
```

Vercel-maintained, accessible, matches shadcn primitives we already use. Saves 1–2 weeks of UI work.

---

## Updated Database Schema (incorporating Vercel chatbot patterns)

```sql
copilot_conversations (
  id uuid pk, org_id uuid, title text,
  visibility text default 'private',  -- 'private' | 'shared' (future: shared with org)
  started_at, ended_at,
  created_by uuid, created_at, updated_at
)

-- Single table replaces my earlier copilot_messages (parts pattern preserves tool calls inline)
copilot_messages (
  id uuid pk, conversation_id uuid fk,
  role text,                  -- 'user' | 'assistant'
  parts jsonb,                -- [{type:'text', text:'...'}, {type:'tool-call', toolName, args, result}, ...]
  attachments jsonb default '[]',
  created_at
)

copilot_runs (
  id uuid pk, org_id uuid, conversation_id uuid fk,
  provider text,              -- 'openrouter' | 'anthropic' | 'ai-gateway'
  model text,
  input_tokens int, output_tokens int,
  estimated_cost_usd numeric(10,4),
  status text,                -- 'streaming' | 'succeeded' | 'failed'
  error text,
  started_at, ended_at, created_at, created_by uuid
)

-- Per-tool-call trace (kept for fine-grained debugging; redundant with parts but useful for SQL queries)
copilot_tool_calls (
  id uuid pk, run_id uuid fk,
  tool_name text, input jsonb, output jsonb, error text,
  status text,                -- 'succeeded' | 'failed'
  duration_ms int,
  created_at
)

-- Resumable stream registry (mirrors Vercel chatbot pattern)
copilot_streams (
  id uuid pk, conversation_id uuid fk,
  redis_stream_id text,       -- key in Redis for resumption
  created_at, expires_at
)
```

---

## Open Questions (resolve in /gsd:discuss-phase)

1. **Should the copilot share the same chat panel as the flow AI builder, or be separate?** Same UI saves work but mixes "build a flow" vs "do something on my CRM" — different mental models.
2. **Confirmation token UX:** literal "CONFIRM" text vs button vs OS-style modal? Voice input would break literal-text confirmation.
3. **Streaming protocol:** SSE vs Vercel AI SDK 5? SSE is what the chat system already uses; AI SDK adds a dep but is more battle-tested for generative UI patterns.
4. **Page-context auto-include:** every page sends context, or only detail pages? List pages might confuse the AI ("which contact?").
5. **Suggested prompts source:** hand-curated per page (Phase D scope), or LLM-generated based on the current page's data shape?
6. **Cross-org guard:** RLS already enforces, but should we hard-fail any tool whose response includes a row not belonging to current org as a defense-in-depth? Probably yes; one-line check.
7. **Cost ceiling:** per-org soft cap (e.g. $10/month) that warns the user? Or trust BYOK entirely? Tend toward warning-only — operator owns the key.
8. **Markdown rendering library:** `react-markdown` (already in tree if knowledge chat uses it) vs `marked` vs custom. Pick one and stick with it.
9. **Should the copilot be allowed to author flows?** I.e. "create a flow that..." from the CRM copilot delegates to the flow AI builder. Unifies the two surfaces — but raises scope question for v1.
10. **Tool versioning:** when we change a tool's schema, do we break old conversation replays? Probably accept the break; conversation replays are diagnostic, not contracts.
11. **Permission model inside an org:** can any member use the copilot, or only certain roles? Today every org member can edit contacts; copilot follows the same baseline. Per-role gating is post-v1.
12. **Audit log retention:** keep `copilot_tool_calls` forever or 90 days? Keep forever for compliance; consider per-org config in v3.
13. **Provider fallback if OpenRouter is down:** auto-fail over to Anthropic if both configured? Or surface the error and let the operator retry? Probably the latter — silent failover masks real problems.
14. **Embedding model usage:** any v1 tools need vector search (e.g. semantic find contacts)? Out of scope for v1; revisit when "find me contacts that look like X" is a real ask.
15. **Localization:** does the master system prompt force English / Portuguese / detect from the user message? Probably detect-and-match.
16. **Migrate flow builder to AI SDK 6 in the same milestone?** Phase C of flow builder uses raw OpenAI/Anthropic SDKs (~200 LOC). Refactoring to AI SDK 6 is a half-day. Doing it in v3.1 means both surfaces share infra; skipping it means tech debt.
17. **Default tool mode:** read-only or read-write? Vercel chatbot exposes all tools always; safer default for CRM is read-only with toggle.
18. **Artifacts in v1 or defer to Milestone C?** The pattern is well-understood (Vercel ships 4 kinds). Could ship `pipeline_report` + `contact_csv` in v1 for an early "wow" moment. Trade-off: scope creep.
19. **Resumable streams in v1 or defer?** Requires Redis (already configured) + `resumable-stream` package. Adds ~50 LOC. Probably yes — operator UX is much better.
20. **Greeting / suggested prompts source:** hand-curated per page (Phase D scope), or hybrid (5 hand-curated defaults + LLM-augmented based on the page's recent data)?

---

## Codebase Hints (for the researcher when promoted)

- **BYOK plumbing already exists:** `src/lib/integrations/get-provider-key.ts` returns the decrypted OpenRouter / Anthropic / OpenAI key for an org. `src/app/(dashboard)/automations/flows/_actions/ai-build.ts` is the canonical example of the resolution order + tool-use loop. Lift `resolveProvider` and `toOpenAiTools` into a shared helper.
- **Action engine substrate:** `src/lib/action-engine/execute-action.ts` already dispatches many CRM mutations (`create_contact`, `create_task`, etc.). Some copilot write tools can delegate to it; others go straight to Supabase with the auth-scoped client.
- **Custom fields stack:** `src/lib/custom-fields/` has Zod-based validation. The copilot's `set_entity_custom_field` tool should reuse `src/lib/custom-fields/validate.ts` to keep schema enforcement consistent.
- **Tag system:** `src/lib/tags/` (or similar — verify) holds the contact_tags + opportunity_tags tables. Copilot read/write tools wrap these.
- **Existing chat infra:** `src/app/api/chat/` and `src/lib/chat/stream/` — patterns for streaming over SSE through a Next.js route handler. Could be lifted/adapted.
- **Knowledge query as reference:** `src/lib/knowledge/query-knowledge.ts` already does OpenRouter-first / Anthropic fallback for synthesis. Same shape.
- **Multi-tenancy:** every new table follows the `(SELECT public.get_current_org_id())` RLS pattern. Service role bypasses for system jobs only.
- **Migration cadence:** numbered SQL in `supabase/migrations/`. Last applied at this seed's planting: 075.
- **shadcn primitives:** `Sheet`, `Sidebar`, `ScrollArea`, `Tooltip`, `Toast` (via sonner) — already in tree, no new deps.
- **Markdown rendering:** check whether `react-markdown` or similar is already a dep before adding. If not, add one consciously.
- **dnd-kit + Zustand:** both already installed (pipeline kanban, flow editor) — reuse for any copilot drag-drop interactions or store patterns.
- **Cost table for OpenRouter:** OpenRouter publishes per-model pricing via API; can fetch + cache. For Anthropic native, use the static pricing page.
- **Flow builder tool dispatch:** `src/lib/flows/ai-tools.ts` is a clean reference for how to structure `Tool[]` + a `dispatchTool(name, input, state)` helper. Copilot's `dispatch.ts` follows the same shape, with state being the Supabase client + conversation context.

### Reference implementation: Vercel Chatbot template (study before Phase A)

Located at `C:\Users\Vanildo\Dev\chatbot` (or [github.com/vercel/ai-chatbot](https://github.com/vercel/ai-chatbot)). The most polished AI SDK 6 reference available.

**Files to read in order:**

1. `app/(chat)/api/chat/route.ts` (314 LOC) — the **entire chat handler**: streaming, tools, resumable streams, persistence, rate limiting. Copilot's `runCopilotTurn` server action follows this shape almost line-for-line.

2. `lib/ai/tools/create-document.ts` — canonical `tool({ description, inputSchema, execute })` pattern. Copy this exact factory shape for every copilot tool.

3. `lib/ai/providers.ts` — provider abstraction. We replace `gateway` with our BYOK resolver but keep the `customProvider` + `wrapLanguageModel` + `extractReasoningMiddleware` patterns.

4. `lib/ai/prompts.ts` — system prompt composition with request hints (geolocation, time, model selection). Pattern for our `current_entity` + `active_org_id` + `user_locale` injection.

5. `components/chat.tsx` + `components/messages.tsx` — frontend chat container using `useChat` from `@ai-sdk/react`. Wires resumable stream resumption + tool approval flow.

6. `components/data-stream-handler.tsx` — listens for typed `data-*` stream parts and updates app state. Pattern for our entity-card / confirmation / chart rendering.

7. `artifacts/text/server.ts` + `artifacts/sheet/server.ts` — pattern for AI-generated side-panel content. Reference when we ship `pipeline_report` / `contact_csv` artifacts in Milestone C (or v1 if we want the wow moment).

8. `lib/db/schema.ts` (Drizzle) — message persistence with `parts` JSONB pattern. Translate to Supabase migration for `copilot_messages`.

9. `lib/ratelimit.ts` — IP rate limiting via Upstash. Adapt to our existing Redis or Supabase pgmq.

10. `app/(chat)/api/chat/schema.ts` — Zod schema for the chat POST body. Pattern for `runCopilotTurn` input validation.

**License:** MIT. Free to study + copy patterns. Direct code lifts should attribute if substantial.

**What NOT to copy from the Vercel chatbot:**
- AI Gateway as primary path (we want BYOK)
- `botid/server` (overkill for authenticated copilot)
- Document artifacts as the only artifact kinds (we add CRM-specific kinds)
- Next-auth (we use Supabase Auth)
- Vercel Blob storage for attachments (we use Supabase Storage)

---

## Key Risks (from prior research patterns)

1. **AI hallucinates IDs.** Model invents `contact_id: "abc123"` and tries to update a non-existent contact. **Mitigation:** every write tool validates the ID exists before applying; on failure, return a clear error the model can read and self-correct.
2. **Destructive ops slip through confirmation gate.** Model misreads the user's intent, fires `delete_contact` without asking. **Mitigation:** required `confirm_token` literal-string param on every destructive tool; dispatcher rejects without it. Also: undo log via Supabase row-level audit trail (`deleted_at` soft-delete pattern on all CRM tables — verify it's already in place).
3. **Cost explosion on heavy tool-use loops.** Model loops querying + replanning, racks up tokens. **Mitigation:** 12-call hard cap per turn; cost telemetry surfaces "expensive prompts" to the operator; per-org soft cap with warning toast.
4. **PII leakage to chosen LLM provider.** Operator picks an OpenRouter route to a model in a jurisdiction they didn't intend. **Mitigation:** doc page explaining BYOK = operator owns the data path; consider org-level allow-list of OpenRouter models in v3.
5. **RLS bypass via service-role accident.** A developer using `createServiceRoleClient` inside a copilot tool. **Mitigation:** lint rule + code review + the tool dispatcher uses the auth-scoped client exclusively.
6. **Streaming + Vercel timeout.** A long tool chain exceeds 800s on Vercel Fluid Compute. **Mitigation:** chunked SSE with heartbeats; if a single turn exceeds the budget, surface a "took too long, try a simpler ask" error.
7. **Conversation context bloat.** After 30 messages the context window is dominated by history, model gets confused. **Mitigation:** sliding window (last 12 messages + an LLM-generated summary of older context) — same pattern Notion AI uses.

---

## References

- Attio AI: https://attio.com (the closest UX analog — pull-out panel, BYOK, entity-aware queries)
- Notion AI cmd-shortcut copilot
- Linear AI search via cmd+K
- HubSpot Breeze: https://www.hubspot.com/products/artificial-intelligence
- Anthropic tool-use docs: https://docs.claude.com/en/docs/agents-and-tools/tool-use
- OpenAI function-calling docs: https://platform.openai.com/docs/guides/function-calling
- OpenRouter docs: https://openrouter.ai/docs
- BYOK precedent in tree: `src/app/(dashboard)/automations/flows/_actions/ai-build.ts`
- RLS pattern reference: `supabase/migrations/001_foundation.sql` section 6 (`get_current_org_id` helper)
- Existing AI synthesis fallback chain: `src/lib/knowledge/query-knowledge.ts`

---

**Status:** Dormant until trigger surfaces.

When promoted, this seed becomes the **v3.1 Natural-Language CRM Copilot** roadmap. The discussion phase resolves the 15 open questions; the planning phase decomposes Phases A–D into individual plans. Expect **~5 weeks of focused work** — the second-largest single feature after SEED-019, but most of the foundation (BYOK resolution, tool-use pattern, RLS, action-engine substrate) already shipped with the flow builder.

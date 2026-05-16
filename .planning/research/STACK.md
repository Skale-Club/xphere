# Technology Stack — v2.0 Multi-Bot Platform (Additions)

**Project:** Operator v2.0 — Channel-Agnostic Agent Abstraction
**Researched:** 2026-05-15
**Scope:** ADDITIONS ON TOP of the validated v1.x stack. This file does NOT re-research Next.js 15, Supabase, pgvector, LangChain (KB only), shadcn/ui, OpenRouter, or `@anthropic-ai/sdk` — all already shipped.

---

## TL;DR — Recommended Additions

| Concern | Recommendation | Verdict |
|---|---|---|
| Agent runtime / orchestration | **Build a thin custom orchestrator** on top of existing `src/lib/chat/stream/` providers. Do NOT adopt LangGraph, OpenAI Agents SDK, or Mastra as the primary runtime. | HIGH confidence |
| Optional helper for tool-loop wiring | **Vercel AI SDK v6 (`ai@^6.0.174`)** — adopt narrowly for its `Agent` / `ToolLoopAgent` class + built-in OpenTelemetry tracing, OR keep the loop fully custom. Decision deferred to first phase. | MEDIUM confidence |
| Multi-agent delegation primitive | **"Agent-as-tool" pattern (Anthropic sub-agent style)** — parent agent exposes partner agents as synthetic tool calls. Loop detection + depth limit live in our orchestrator, not in a library. | HIGH confidence |
| Observability storage | **Extend Supabase** with new `agent_invocations` + `agent_invocation_steps` tables. Keep existing `action_logs` for tool-level execution. | HIGH confidence |
| Observability transport | **OpenTelemetry exporter** (optional, gated by env var) → self-hosted **Langfuse** later. NOT required for v2.0 ship. | MEDIUM confidence |
| Prompt versioning | **Append-only `agent_prompt_versions` table** with `agents.active_prompt_version_id` FK. Plain SQL. No extension, no JSONB diff. | HIGH confidence |
| Tool scoping (agent-level RBAC) | **Junction table `agent_tools(agent_id, tool_config_id, allowed)`** with deny-by-default at `resolve-tool.ts`. No new library. | HIGH confidence |

**One sentence:** Add at most ONE new dependency (`ai@^6`), three new tables (`agents`, `agent_prompt_versions`, `agent_tools`) plus one junction (`agent_partners`) plus two observability tables (`agent_invocations`, `agent_invocation_steps`), and one new directory `src/lib/agent-runtime/`.

---

## 1. Agent Runtime / Orchestration

### Recommendation: Build custom on existing stream abstraction

**What to build:**
- New module `src/lib/agent-runtime/` exposing `runAgent(agentId, channel, context)`
- Internally calls existing `streamOpenRouter` / `streamAnthropic` from `src/lib/chat/stream/`
- Adds: per-agent system prompt assembly, per-channel override merge, tool whitelist filtering, delegation hook

**Why custom over a framework:**

| Framework | Version | Why NOT primary |
|---|---|---|
| LangGraph JS (`@langchain/langgraph`) | `^1.3.0` (verified npm, ~8 days old) | Graph-based orchestration shines for stateful multi-step workflows with branching. Operator's chat path is **request/response with optional sub-agent call** — overkill. Adds a `StateGraph` mental model and `Annotation.Root` boilerplate that fights our existing streaming abstraction. Useful in the future if delegation grows into DAGs; YAGNI for v2.0. |
| OpenAI Agents SDK (`@openai/agents`) | `^0.11.3` (verified npm, ~15h old at research time) | Built on OpenAI's Responses API. Operator uses **OpenRouter (multi-model) + Anthropic SDK** — adopting `@openai/agents` either forces a third provider path or wraps OpenRouter awkwardly. Also still pre-1.0 (0.11.x) — frequent breaking changes per their npm history. |
| Mastra (`mastra@^1.0`) | `1.0+` (Jan 2026, Y Combinator-backed) | Opinionated full-framework: agents, workflows, RAG, memory, evals, MCP, deploy adapters. Operator already has RAG (LangChain SupabaseVectorStore), memory (Redis + `conversations`), and deploy (Vercel). Adopting Mastra means either replacing those subsystems or running two parallel systems. Better fit for greenfield agentic apps. |
| "Anthropic Agent SDK" | n/a as a separate JS package | The closest things are (a) `@anthropic-ai/sdk` (already installed `^0.82.0`) tool-use loops, or (b) `claude-agent-sdk` (Python-only / tooling-oriented). Neither replaces what we'd build for the channel-agnostic chat runtime. |

**Optional narrow adoption — Vercel AI SDK v6 `Agent` / `ToolLoopAgent` class:**

`ai@^6.0.174` (verified npm, ~3 days old at research time; v6 announced Jan 2026). Pros:

- Built-in OpenTelemetry tracing (`experimental_telemetry: { isEnabled: true }`) — pairs cleanly with Langfuse later via `@langfuse/otel`
- `ToolLoopAgent` codifies the LLM → tool → result → LLM loop with `stopWhen` + `prepareStep`
- Native multi-provider via `@ai-sdk/openai`, `@ai-sdk/anthropic` adapters
- Wide adoption (>1M weekly downloads as of early 2026)

Cons:
- Migrating off bespoke `streamOpenRouter` + `streamAnthropic` (shipped + tested in v1.4 refactor) is a regression risk on already-shipped chat
- v6 just landed (Jan 2026) — small but real breaking-change risk vs the more mature v5 line
- OpenRouter is consumed via `@ai-sdk/openai` + `baseURL` override — works but is a community pattern, not a first-class provider

**Decision rule for the roadmap:** in the first phase of v2.0, spike `ai@^6` as a drop-in replacement for `streamOpenRouter` + `streamAnthropic`. If it fits cleanly in <1 day, adopt it. Otherwise keep custom and only adopt OpenTelemetry hooks separately (a much smaller install).

**Integration points (named files):**
- `src/lib/chat/stream.ts` (line 60 `createChatStream`) — replace monolithic prompt block at lines 96-107 with a call into `runAgent()`
- `src/lib/chat/stream/anthropic.ts` and `src/lib/chat/stream/openrouter.ts` — keep, but invoked from inside `runAgent` rather than directly from `stream.ts`
- All inbound channel handlers (`src/app/api/chat/[token]/route.ts`, `src/app/api/manychat/*`, `src/app/api/meta/*`, future Telegram) become thin shells that call `runAgent(agentId, channel, channelContext)`

### Anti-recommendation
- Do NOT adopt **AutoGen** (Microsoft) — Python-first, .NET secondary; JS support is community/experimental
- Do NOT adopt **CrewAI** — Python-only
- Do NOT adopt **LangChain Agents** (`AgentExecutor`) — legacy LangChain agent path; superseded by LangGraph even in LangChain's own docs. Our LangChain footprint is already scoped to KB retrieval; don't expand it.
- Do NOT adopt **`langchain` agent helpers** (currently `^1.3.0` in `package.json` line 50) for the runtime — the package is fine for vectorstore use, but its agent surface is the wrong abstraction here.

---

## 2. Multi-Agent Delegation Primitive

### Recommendation: "Agent-as-tool" pattern (Anthropic sub-agent style)

**Mechanism:** when an agent has partner agents configured, `runAgent` builds synthetic tool definitions of the form:

```ts
{
  name: `delegate_to_${partnerSlug}`,
  description: partner.delegation_hint, // e.g. "Use for billing questions"
  input_schema: {
    type: 'object',
    properties: {
      context_summary: { type: 'string', description: 'What the partner needs to know' },
      user_question:   { type: 'string', description: 'The specific question to answer' }
    },
    required: ['user_question']
  }
}
```

When the LLM emits that tool call, our executor (`src/lib/agent-runtime/delegate.ts`) — instead of routing through `executeAction` — recursively invokes `runAgent(partnerAgentId, channel, derivedContext)` and returns its final reply as the tool result. The parent LLM then completes its own user-facing response.

**Why this over alternatives:**

| Pattern | Source | Why NOT |
|---|---|---|
| Supervisor graph | `@langchain/langgraph-supervisor` (`@langchain/langgraph` v1.3.0) | Requires adopting LangGraph as the runtime. See §1. |
| OpenAI Swarm-style `handoffs` | `@openai/agents` `handoffs` API | Clean API but tied to `@openai/agents` runtime. Also "handoff" replaces the active agent — we want **call/return** semantics so the parent finishes the user-facing reply. |
| Direct LLM-to-LLM message passing | custom protocol | Reinvents tool-calling. The LLM is already trained on tool-call format; piggyback on it. |
| Anthropic native sub-agent (Claude Code style) | n/a as library | This IS the pattern we're copying — it's a design choice, not a dependency. |

**Loop detection (our code, no library):**
- Each invocation carries `delegation_path: string[]` (agent IDs visited)
- Before delegating: if `partnerId` already in `delegation_path` → return synthetic tool error `"Already in delegation chain — synthesize answer from current context."`
- Hard `MAX_DELEGATION_DEPTH = 3` (config-tunable per org later)
- Hard `MAX_DELEGATIONS_PER_INVOCATION = 5` (prevents one parent calling the same partner 50 times)

**Shared context (our code):**
- Pass user's original message verbatim
- Pass `context_summary` from the parent's tool-call argument — lets the parent decide what's relevant
- Do NOT pass full conversation history by default (token bloat) — opt-in via agent config flag `partner_inherits_history: boolean`

**Integration points (new files):**
- `src/lib/agent-runtime/delegate.ts` — invocation + loop detection
- `src/lib/agent-runtime/build-partner-tools.ts` — synthesizes `delegate_to_*` tool defs
- Schema: `agent_partners(parent_agent_id, partner_agent_id, delegation_hint, position)` junction table with UNIQUE(parent_agent_id, partner_agent_id)

### Anti-recommendation
- Do NOT use shared mutable state between parent and partner (e.g. a "scratchpad" object). Sub-agent must be a **pure function** of its input — same delegation, same result. Easier to test, debug, replay.
- Do NOT allow delegation cycles even one level deep (A→B→A). Loop detection rejects cycles of any length.
- Do NOT stream partner agent tokens directly to the user. The partner's reply is a *tool result* for the parent to read; only the parent's final tokens are user-facing. This preserves a single voice per conversation.

---

## 3. Observability — Per-Agent Metrics

### Recommendation: extend Supabase, defer external tools

**Schema additions:**

| Table | Purpose | Indexed by |
|---|---|---|
| `agent_invocations` | One row per `runAgent()` call. Columns: id, org_id, agent_id, channel, parent_invocation_id (nullable, for delegations), conversation_id (nullable), user_message_hash, total_tokens_input, total_tokens_output, total_cost_usd, total_latency_ms, status ('ok' / 'error' / 'tool_failed'), error_summary, started_at, ended_at | (org_id, agent_id, started_at desc), (parent_invocation_id), (conversation_id) |
| `agent_invocation_steps` | One row per LLM call or tool call inside an invocation. Columns: id, invocation_id, step_index, kind ('llm' / 'tool' / 'delegation'), model (for llm), tokens_input, tokens_output, cost_usd, latency_ms, tool_name (for tool/delegation), tool_result_chars, action_log_id (nullable FK to action_logs), error | (invocation_id, step_index) |

**Why NOT extend `action_logs`:** `action_logs` is the system-of-record for **tool execution attempts** — used by Vapi voice path, used by ops debugging, written by `executeAction` (see `src/lib/action-engine/execute-action.ts`). Mixing in LLM-call rows would:
1. Inflate the table 5-10x and slow existing ops queries
2. Conflate "did the GHL API call work" with "did the LLM behave"
3. Break the existing shared schema between Vapi voice and chat paths

Keep `action_logs` as the canonical tool-execution audit log. Reference it via `agent_invocation_steps.action_log_id` (nullable FK) when a step actually triggered an action.

**Why Supabase first, external second:**
- All data already lives in Supabase. Joining cost-per-agent to message history is one query.
- RLS gives us multi-tenancy for free via `get_current_org_id()` — no separate tenant model in an external tool.
- Defer Langfuse adoption until we have someone actively building dashboards on it.

**Optional transport: OpenTelemetry → Langfuse (self-hosted) — future**

When/if needed, the path is well-paved:

| Library | License | Role |
|---|---|---|
| `@langfuse/tracing` | MIT | Langfuse OTel SDK |
| `@langfuse/otel` | MIT | Span processor — converts OTel spans to Langfuse traces |
| `@opentelemetry/sdk-node` | Apache 2.0 | OTel runtime |
| Langfuse self-hosted | MIT | Stack: PostgreSQL + ClickHouse + Redis + S3 (heavy — see anti-recommendation) |

If we adopt Vercel AI SDK v6 (§1), `experimental_telemetry: { isEnabled: true }` automatically emits OTel spans matching the AI SDK semantic conventions. They can then be exported to any OTel-compatible backend.

### Anti-recommendation
- Do NOT adopt **Helicone** as primary observability. It's a proxy in front of the LLM provider — incompatible with `@anthropic-ai/sdk` streaming (already in `src/lib/chat/stream/anthropic.ts`) and would require routing all calls through their endpoint. Multi-agent delegation graphs aren't its strength (post-hoc stitching only).
- Do NOT spin up self-hosted Langfuse in v2.0. The stack (Postgres + ClickHouse + Redis + S3 + Kubernetes for production scale) is heavier than our entire current infrastructure. Use Supabase tables; revisit when we have >10 agents per org and ops needs aggregated dashboards.
- Do NOT use **LangSmith** — proprietary, paid past a small free tier, tied to LangChain orchestration semantics we're not adopting.

---

## 4. Prompt Versioning (Schema-only)

### Recommendation: append-only `agent_prompt_versions` table

**Schema:**

```sql
create table agent_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  version integer not null,
  prompt text not null,
  model text,                    -- nullable; null = inherit from agent
  channel_overrides jsonb,       -- nullable; per-channel prompt patches
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  notes text,
  unique (agent_id, version)
);

alter table agents
  add column active_prompt_version_id uuid references agent_prompt_versions(id);
```

**Why this over alternatives:**

| Alternative | Why NOT |
|---|---|
| `temporal_tables` Postgres extension | Supabase managed plan does not expose arbitrary extensions; even if it did, semantics ("system-versioned table") are overkill — we want explicit numbered versions a user can refer to in support tickets and a future rollback UI. |
| JSONB diff in same row | Loses easy "what was the prompt 3 weeks ago" queries. Diffs are hard to render in a UI. |
| Git-backed (commit prompts to repo) | Couples agent definition to code deploys — defeats the point of the admin UI. |
| Generic `agent_history` audit table on all columns | Captures too much (every CRUD field) and not enough (no first-class "version" concept). |

**Behavior:**
- `agents.active_prompt_version_id` controls what `runAgent` loads at request time
- Editing a prompt in the UI → INSERT new row in `agent_prompt_versions` + UPDATE `agents.active_prompt_version_id`
- Rollback = UPDATE `agents.active_prompt_version_id` to an older row's id
- No version is ever deleted (append-only)

**Out of scope for v2.0:** A/B testing UI, traffic splitting, automated eval gates. Schema supports all of these later.

### Anti-recommendation
- Do NOT store prompt versions in a JSONB array on `agents`. Loses row-level RLS granularity, inflates row size, breaks pagination of version history.
- Do NOT use generic pg_history-style triggers on `agents`. They capture every field on every UPDATE — noisy, and we don't want to version e.g. `last_used_at` ticks.

---

## 5. Tool Scoping (Agent-Level RBAC)

### Recommendation: junction table `agent_tools` with deny-by-default

**Schema:**

```sql
create table agent_tools (
  agent_id uuid not null references agents(id) on delete cascade,
  tool_config_id uuid not null references tool_configs(id) on delete cascade,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (agent_id, tool_config_id)
);
```

**Enforcement point:** `src/lib/action-engine/resolve-tool.ts` (line 28 `resolveTool`).

Today's signature:
```ts
resolveTool(orgId, toolName, supabase)
```

Becomes:
```ts
resolveTool(orgId, toolName, supabase, { agentId?: string })
```

When `agentId` is provided (chat path), add an extra `.eq('agent_tools.agent_id', agentId).eq('agent_tools.allowed', true)` join. When `agentId` is omitted (Vapi voice path — unchanged), behave as today (org-scoped only). This is the single backwards-compat seam.

**Policy: deny-by-default**
- An agent sees NO tools unless an explicit `agent_tools` row says `allowed = true`
- Removing the junction row = revoke
- Org admin can bulk-grant via the agent edit UI ("select all tools" checkbox at create time)

**Why this over alternatives:**

| Alternative | Why NOT |
|---|---|
| Capability tokens (JWT-style) | Overengineered. Operator's tools resolve through our DB, not cross-service tokens. |
| Wildcards in agent config JSONB (`{ allowed_tools: ["*"] }`) | Loses referential integrity. Deleted `tool_configs` rows orphan the array. |
| Allowlist column on `tool_configs` (`allowed_agent_ids[]`) | Reverses the join awkwardly. Adding an agent requires updating every tool row. |
| Roles + role-tool junction (`agent_roles` → `agent_role_tools`) | Premature abstraction. If we ever need it, refactor is straightforward — insert `agent_roles` between `agents` and `agent_tools` later. |

**Backwards compatibility:**
- Vapi path keeps calling `resolveTool(orgId, toolName, supabase)` (no `agentId` arg) — org-scoped behavior preserved
- Chat path migrates to `resolveTool(orgId, toolName, supabase, { agentId })` and gets RBAC
- Migration script: for each existing org, create a "default agent" and grant it ALL current `tool_configs` rows → no behavior change for existing chat installs

### Anti-recommendation
- Do NOT enforce scoping in a middleware-style wrapper outside `resolve-tool.ts`. Single chokepoint = single audit target.
- Do NOT use Supabase RLS for agent-level scoping. RLS is for **tenant** isolation. Agent-level RBAC is application logic — putting it in RLS would couple two unrelated authorization layers and make debugging painful.

---

## Installation Summary

**Required new dependencies for v2.0:** none mandatory.

**Optional new dependencies (decided in first phase, before any schema work):**
```bash
# Option A — keep custom orchestrator (no new deps)
# (no install needed)

# Option B — adopt Vercel AI SDK v6 for tool loop + telemetry
npm install ai@^6.0.174 @ai-sdk/anthropic@latest @ai-sdk/openai@latest

# Optional later (deferred past v2.0 — only if we need cross-system tracing)
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

**Files to create:**

| Path | Purpose |
|---|---|
| `src/lib/agent-runtime/run-agent.ts` | Entry point `runAgent(agentId, channel, context)` |
| `src/lib/agent-runtime/load-agent.ts` | Fetches agent + active prompt version + allowed tools |
| `src/lib/agent-runtime/build-system-prompt.ts` | Merges base prompt + channel overrides |
| `src/lib/agent-runtime/delegate.ts` | Sub-agent invocation + loop detection |
| `src/lib/agent-runtime/build-partner-tools.ts` | Synthesizes `delegate_to_*` tool defs |
| `src/lib/agent-runtime/record-invocation.ts` | Writes to `agent_invocations` / `agent_invocation_steps` |
| `supabase/migrations/0XX_agents.sql` | Tables: agents, agent_prompt_versions |
| `supabase/migrations/0XX_agent_tools.sql` | Table: agent_tools (RBAC) |
| `supabase/migrations/0XX_agent_partners.sql` | Table: agent_partners (delegation) |
| `supabase/migrations/0XX_agent_observability.sql` | Tables: agent_invocations, agent_invocation_steps |

**Files to modify:**

| Path | Change |
|---|---|
| `src/lib/chat/stream.ts` (line 60 `createChatStream`) | Replace monolithic system prompt block (lines 96-107) with `await runAgent(agentId, channel, ctx)` |
| `src/lib/action-engine/resolve-tool.ts` (line 28 `resolveTool`) | Accept optional `agentId` arg; add `agent_tools` join when provided |
| `src/app/api/chat/[token]/route.ts` | Pass `agentId` resolved from widget/org config |
| `src/app/api/manychat/webhook/route.ts` | Resolve `agentId` from inbound bot mapping |
| `src/app/api/meta/webhook/route.ts` | Resolve `agentId` from inbound page/account mapping |
| `src/types/database.ts` | Regenerate after migrations land |

---

## Sources

- [Vercel AI SDK 6 announcement](https://vercel.com/blog/ai-sdk-6) — Agent class, OpenTelemetry built-in
- [`ai` on npm](https://www.npmjs.com/package/ai) — current `6.0.174`
- [Vercel AI SDK 5 → 6 migration guide (2026)](https://www.pkgpulse.com/guides/vercel-ai-sdk-5-migration-2026)
- [Vercel: How to build AI Agents with the AI SDK](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk)
- [OpenAI Agents SDK (JS) GitHub](https://github.com/openai/openai-agents-js) — pattern reference for handoffs/guardrails
- [`@openai/agents` on npm](https://www.npmjs.com/package/@openai/agents) — current `0.11.3`
- [LangGraph JS GitHub](https://github.com/langchain-ai/langgraphjs) — supervisor pattern reference
- [`@langchain/langgraph` on npm](https://www.npmjs.com/package/@langchain/langgraph) — current `1.3.0`
- [LangGraph Supervisor Pattern (2026 guide)](https://callsphere.ai/blog/langgraph-supervisor-multi-agent-orchestration-2026)
- [Mastra GitHub](https://github.com/mastra-ai/mastra) — full-framework reference (NOT adopted for v2.0)
- [Mastra 1.0 release (Jan 2026)](https://mastra.ai/categories/announcements)
- [Langfuse OpenTelemetry integration with Vercel AI SDK](https://langfuse.com/integrations/frameworks/vercel-ai-sdk)
- [Langfuse self-hosting requirements](https://langfuse.com/self-hosting/configuration/observability)
- [Langfuse vs Helicone vs LangSmith vs Braintrust (2026)](https://appscale.blog/en/blog/langfuse-vs-langsmith-vs-braintrust-vs-helicone-2026)
- [Best Multi-Agent Frameworks in 2026 (overview)](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- Existing `@anthropic-ai/sdk@^0.82.0` in `package.json` line 22 — already shipped, used in `src/lib/chat/stream/anthropic.ts`

**Confidence calibration:**
- Version numbers verified via npm and official release blogs in May 2026 (HIGH).
- "Custom orchestrator over framework adoption" is HIGH confidence — Operator already has working streaming + tool-call code in `src/lib/chat/stream/`; building on it is lower risk than swapping it out.
- Vercel AI SDK v6 narrow adoption is MEDIUM confidence — v6 just landed (Jan 2026), small breaking-change risk; deferring the decision to first-phase spike is the pragmatic call.
- Langfuse deferral is MEDIUM confidence — infrastructure cost is the dominant factor; if the team grows or external auditing becomes a hard requirement, revisit.

---

*Stack additions for: Operator v2.0 — Multi-Bot Platform (Channel-Agnostic Agent Abstraction)*
*Researched: 2026-05-15*

# Architecture Research — v2.0 Multi-Bot Platform

**Domain:** Channel-agnostic agent abstraction over existing Operator chat runtime
**Researched:** 2026-05-15
**Confidence:** HIGH (based on direct read of existing chat/action-engine code, RLS schema, and inbound handlers)

> **Framing:** This is an **integration** architecture, not a greenfield design. v2.0 wraps existing primitives (`src/lib/chat/`, `src/lib/action-engine/`, `src/lib/knowledge/`) with a new agent layer. Vapi (`src/app/api/vapi/*`, `assistant_mappings`) is explicitly untouched.

---

## System Overview

### Current shape (v1.x — what's already there)

```
                Inbound text channels                       Inbound voice (untouched)
   ┌──────────┬──────────────┬────────────┐                ┌────────────────────┐
   │  Widget  │   ManyChat   │  Meta IG   │                │  Vapi webhooks     │
   │  POST    │  webhook     │  Messenger │                │  /api/vapi/tools   │
   │ /api/chat│              │            │                │                    │
   └────┬─────┴───────┬──────┴──────┬─────┘                └─────────┬──────────┘
        │             │             │                                │
        ▼             ▼             ▼                                ▼
  ┌─────────────────────────────────────────────┐         ┌─────────────────────┐
  │       src/lib/chat/stream.ts                │         │ assistant_mappings  │
  │  (single hardcoded system prompt per org)   │         │   (vapi_id → org)   │
  │  ├── queryKnowledge() inline                │         └──────────┬──────────┘
  │  ├── TOOL_SCHEMAS hardcoded                 │                    │
  │  └── streamOpenRouter | streamAnthropic     │                    │
  └────────────────────┬────────────────────────┘                    │
                       │                                              │
                       ▼                                              ▼
           ┌──────────────────────────────────────────────────────────────┐
           │             src/lib/action-engine/                            │
           │   resolveTool(orgId, toolName)  →  executeAction(...)         │
           │   (org-scoped only — no agent awareness)                      │
           └──────────────────────────────────────────────────────────────┘
```

### v2.0 shape (what we're adding)

```
   ┌──────────┬──────────────┬────────────┬─────────────┐       ┌────────────┐
   │  Widget  │   ManyChat   │  Meta IG   │  Telegram   │       │   Vapi     │
   │          │              │            │  (future)   │       │ (UNCHANGED)│
   └────┬─────┴───────┬──────┴──────┬─────┴──────┬──────┘       └─────┬──────┘
        │             │             │            │                    │
        │ resolveAgentForChannel(org, channel) → agentId              │
        ▼             ▼             ▼            ▼                    │
  ┌─────────────────────────────────────────────────────┐             │
  │           NEW: src/lib/agent-runtime/                │             │
  │  ┌───────────────────────────────────────────────┐  │             │
  │  │  runAgent(agentId, channel, ctx) → Stream     │  │             │
  │  │   ├── load Agent + tools + partners (cached)  │  │             │
  │  │   ├── apply channel_overrides                 │  │             │
  │  │   ├── build SystemPrompt + ToolSet            │  │             │
  │  │   ├── delegate to streamChat() with AgentCtx  │  │             │
  │  │   └── handle call_partner tool calls          │  │             │
  │  └───────────────────────────────────────────────┘  │             │
  └─────────────────────┬───────────────────────────────┘             │
                        │ (passes AgentContext)                       │
                        ▼                                              │
  ┌────────────────────────────────────────────────────┐               │
  │   REFACTORED: src/lib/chat/stream.ts                │               │
  │   streamChat(agentCtx, ...)                         │               │
  │   ├── no longer fetches KB inline (agent decides)   │               │
  │   ├── tools come from AgentContext.tools            │               │
  │   ├── system prompt comes from AgentContext.prompt  │               │
  │   └── streamOpenRouter | streamAnthropic (kept)     │               │
  └────────────────────┬───────────────────────────────┘               │
                       │                                                │
                       ▼                                                ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │              src/lib/action-engine/                                      │
  │   resolveTool(orgId, toolName)   ← KEPT, Vapi still uses this           │
  │   resolveAgentTool(agentId, toolName)  ← NEW (chat path uses this)      │
  │   executeAction(...)             ← UNCHANGED                            │
  └─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | File(s) |
|-----------|----------------|---------|
| **Agent registry** | CRUD over `agents`, prompt versioning, channel overrides | `src/lib/agent-runtime/registry.ts` (NEW) |
| **Agent runtime** | `runAgent()` entry, partner delegation, loop/depth control | `src/lib/agent-runtime/run.ts` (NEW) |
| **Agent resolver** | Map `(org, channel)` → default `agentId` for that channel | `src/lib/agent-runtime/resolve.ts` (NEW) |
| **Chat stream** | LLM streaming primitives (Anthropic + OpenRouter) | `src/lib/chat/stream.ts` (refactored) |
| **Action engine** | Tool execution dispatch | `src/lib/action-engine/execute-action.ts` (unchanged) |
| **Tool scoping** | Filter org-tools to agent-allowed subset | `src/lib/action-engine/resolve-agent-tool.ts` (NEW) |
| **Knowledge** | pgvector RAG | `src/lib/knowledge/query-knowledge.ts` (unchanged; KB-scope filter added) |
| **Inbound channel handlers** | HTTP/webhook ingress → call `runAgent()` | `src/app/api/chat/[token]/`, `src/app/api/manychat/`, `src/lib/meta/process-event.ts` |
| **Observability** | Per-invocation log: agent_id, channel, tokens, cost, partner trace | `src/lib/agent-runtime/observability.ts` (NEW) + `agent_invocations` table |

---

## Recommended Project Structure

```
src/
├── lib/
│   ├── agent-runtime/                ── NEW MODULE
│   │   ├── run.ts                    runAgent() entry point + delegation loop
│   │   ├── registry.ts               loadAgent(), CRUD helpers
│   │   ├── resolve.ts                resolveAgentForChannel(org, channel) lookup
│   │   ├── system-prompt.ts          buildSystemPrompt(agent, channel, kbContext)
│   │   ├── tool-set.ts               buildAgentToolSet(agent) — fetches scoped tools
│   │   ├── partner-tool.ts           injects synthetic call_partner_<slug> tools
│   │   ├── delegation.ts             handleDelegation(), loop/depth guards
│   │   ├── observability.ts          logInvocation(), aggregates partner trace
│   │   └── types.ts                  AgentContext, AgentRunOptions, RunResult
│   ├── chat/
│   │   ├── stream.ts                 REFACTORED: accepts AgentContext
│   │   ├── stream/
│   │   │   ├── anthropic.ts          unchanged signature; tools come from ctx
│   │   │   ├── openrouter.ts         unchanged signature; tools come from ctx
│   │   │   ├── tool-schemas.ts       UPDATED: also generate schemas for partner tools
│   │   │   └── encoder.ts            unchanged
│   │   ├── session.ts                unchanged
│   │   └── persist.ts                unchanged
│   └── action-engine/
│       ├── resolve-tool.ts           UNCHANGED (Vapi keeps calling this)
│       ├── resolve-tool-by-id.ts     unchanged
│       ├── resolve-agent-tool.ts     NEW: (agentId, toolName) → tool_config
│       └── execute-action.ts         unchanged
├── app/
│   ├── (dashboard)/
│   │   └── agents/                   NEW UI
│   │       ├── page.tsx              agent list
│   │       ├── new/page.tsx          create
│   │       └── [id]/
│   │           ├── page.tsx          edit (prompt, model, tools, partners, overrides)
│   │           ├── playground/       multi-channel test harness
│   │           └── invocations/      observability drill-down
│   └── api/
│       ├── chat/[token]/route.ts     CHANGED: calls runAgent() instead of createChatStream()
│       ├── manychat/webhook/         CHANGED downstream in dispatch-event.ts
│       ├── meta/webhook/             CHANGED downstream in process-event.ts
│       └── vapi/                     UNCHANGED
└── types/
    └── database.ts                   regenerated after each migration
supabase/
└── migrations/
    ├── 034_agents.sql                agents + agent_tools + agent_partners
    ├── 035_agent_prompt_versions.sql versioning
    ├── 036_agent_channel_defaults.sql org_id × channel → agent_id mapping
    └── 037_agent_invocations.sql     observability
```

### Structure Rationale

- **`src/lib/agent-runtime/` as a new peer of `src/lib/chat/`** — agents are a higher abstraction than chat. They *use* chat as a primitive. Putting agent code inside `chat/` would re-create the same coupling we're trying to remove. The runtime owns prompt assembly, tool scoping, and delegation; `chat/` stays as "LLM streaming primitives."
- **No "agents" subfolder under `chat/`** — chat is one consumer of agents. WhatsApp/Meta/ManyChat are equal peers. Putting agents under chat would re-impose channel hierarchy we explicitly reject.
- **`resolve-tool.ts` stays untouched** — Vapi's webhook `/api/vapi/tools` doesn't know what an agent is. A sibling `resolve-agent-tool.ts` adds the new path without forking shared code.
- **`agents/` dashboard route at top level** — agents are first-class entities, deserving a top-level nav slot alongside `/integrations`, `/tools`, `/knowledge`, `/observability`.

---

## Architectural Patterns

### Pattern 1: `runAgent()` returns a `ReadableStream` (same protocol as `createChatStream`)

**What:** The runtime entry point matches the existing SSE protocol so widget/handler code changes are minimal.

**When to use:** Always — every inbound channel calls `runAgent()`.

**Trade-offs:** Forces all channels onto streaming semantics even when (e.g. ManyChat External Request) the channel really wants a single response. Mitigation: a `collectStream()` helper that drains a `ReadableStream` to a single string for non-streaming channels.

**Signature:**

```typescript
// src/lib/agent-runtime/types.ts
export interface AgentRunContext {
  orgId: string
  agentId: string
  channel: 'web_widget' | 'whatsapp' | 'messenger' | 'instagram' | 'manychat' | 'telegram'
  conversationId: string          // db_session_id or conversations.id
  sessionId?: string              // widget-only ephemeral id
  message: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  supabase: SupabaseClient<Database>
  // Optional channel-specific extras (e.g. ManyChat subscriber_id) passed via metadata
  metadata?: Record<string, unknown>
  // Delegation tracking (set internally when called from a parent agent)
  _depth?: number
  _callStack?: string[]           // [parentAgentId, grandparentAgentId, ...]
  _rootInvocationId?: string      // links all delegated calls to one observability row
}

export interface AgentRunOptions {
  /** If true, returns a stream; if false, returns a Promise<string>. */
  stream: boolean
  /** Emit SSE events to caller (only used when stream=true). */
  emit?: (obj: object) => void
  /** Accumulate reply text for persistence (caller closes over `let acc = ''`). */
  onReplyChunk?: (chunk: string) => void
}

export type AgentRunResult =
  | { kind: 'stream'; stream: ReadableStream }
  | { kind: 'text'; reply: string; invocationId: string }

// src/lib/agent-runtime/run.ts
export async function runAgent(
  ctx: AgentRunContext,
  opts: AgentRunOptions
): Promise<AgentRunResult>
```

**Critical invariant:** `runAgent()` never throws on agent-level errors — it emits a degraded reply (the agent's configured `fallback_message`) and returns. Only schema/auth violations may throw (caller logs them).

### Pattern 2: `streamChat()` becomes a primitive consumed by `runAgent()`

**What:** Refactor `createChatStream()` (in `src/lib/chat/stream.ts`) to accept an `AgentContext`. KB pre-retrieval and tool-list assembly move *out* of stream.ts and *into* the runtime.

**Before (v1.4):**
```typescript
createChatStream({ orgId, orgName, message, toolsWithCreds, ... })
  // inside: hardcoded systemPrompt, inline queryKnowledge, inline tool building
```

**After (v2.0):**
```typescript
// chat/stream.ts owns LLM streaming only
streamChat({
  systemPrompt,         // ← built upstream by runtime
  history,              // ← agent's history window (respects per-channel max)
  message,
  tools,                // ← already-scoped Anthropic/OpenAI tool defs
  toolsWithCreds,       // ← already filtered to this agent's allowed tools
  providerKeys: { openrouter, anthropic },
  orgId, supabase,      // ← still needed for tool execution context
  emit, onReplyChunk,
})
```

**Trade-offs:** Forces a refactor of `stream.ts` exports (breaks chat/stream/tool-schemas.ts builders' positional assumptions). Mitigation: keep `createChatStream()` as a thin shim wrapping the new `streamChat()` for the duration of the migration, then remove after all callers migrate.

### Pattern 3: Partner agents exposed as synthetic tools (in-band delegation)

**What:** When agent A is configured with partner B, the runtime injects a synthetic LLM tool `call_partner_<b.slug>` into A's tool list. The LLM "calls" the partner the same way it calls `create_contact`. The runtime intercepts that tool name, recursively invokes `runAgent()` for B, and returns B's response as the tool result back to A.

**When to use:** All v2.0 delegation. Avoids inventing a new LLM control protocol.

**Trade-offs:**
- *Pro:* Zero new LLM contract. Both Anthropic and OpenRouter handle tool calls identically. UI representation is also free — partner calls show up in the SSE stream as `{event: 'tool_call', name: 'call_partner_<slug>'}` and we add a new event `{event: 'partner_start', from, to}` purely cosmetic.
- *Con:* The LLM "sees" partner output flattened to a string. If a partner streams 800 tokens, the parent agent re-processes them as tool-result context (cost spike). Mitigation: a max-summary-length budget per partner; cap depth at 2.
- *Con:* Doesn't allow streaming partner output to the end user in real time. The end user waits for partner to complete, then sees parent's continuation. v2.0 acceptable; v2.x can add streaming relay (`{event: 'partner_token', text}` passthrough).

**Wire shape (SSE):**
```
event: session    { sessionId }
event: token      { text: "Let me check that with our specialist..." }
event: partner_start { from: 'agent_main', to: 'agent_billing', depth: 1 }
event: tool_call  { name: 'call_partner_billing' }  // (debug-style, optional)
event: partner_token { text: "..." }                 // (deferred to v2.x)
event: partner_done  { from: 'agent_billing', tokens: 142 }
event: token      { text: "Here's what they said: ..." }
event: done
```

**Loop/depth guards** (in `delegation.ts`):
```typescript
const MAX_DEPTH = 2
const MAX_PARTNERS_PER_TURN = 3

if (ctx._depth && ctx._depth >= MAX_DEPTH) {
  return errorResult('Maximum delegation depth reached')
}
if (ctx._callStack?.includes(targetAgentId)) {
  return errorResult('Circular delegation detected')
}
```

### Pattern 4: Channel overrides as JSONB merge, not row fork

**What:** `agents.channel_overrides` is a JSONB column shaped as `{ [channel]: Partial<AgentSpec> }`. The runtime fetches the agent row, then deep-merges `channel_overrides[ctx.channel]` over the base fields.

**Example shape:**
```json
{
  "whatsapp": {
    "system_prompt_suffix": "\n\nKeep responses under 200 characters. No markdown.",
    "model": "anthropic/claude-haiku-4-5",
    "max_history": 6
  },
  "web_widget": {
    "system_prompt_suffix": "\n\nMarkdown is supported. Use bullet points for lists."
  }
}
```

**When to use:** Per-channel tweaks (prompt deltas, max history, model swaps). Anything larger should be a separate agent.

**Trade-offs:** Merge semantics need to be documented (suffix-append for prompts, overwrite for scalars, overwrite for arrays). A `schema/agent-overrides.ts` zod parser enforces shape.

### Pattern 5: Agent resolution via per-channel default mapping

**What:** A new table `agent_channel_defaults` maps `(org_id, channel)` → `agent_id`. Inbound handlers call `resolveAgentForChannel(orgId, channel)` to find which agent owns this conversation. v2.0 = one default agent per channel per org. v2.x can add per-conversation override.

**When to use:** Every inbound handler before invoking the runtime.

**Trade-offs:** Adds a DB lookup per inbound message. Cache by `(orgId, channel)` in a per-request memo (Next `cache()`).

---

## Schema Sketch

> **All tables follow Operator conventions: `id UUID PK default gen_random_uuid()`, `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, RLS enabled with `get_current_org_id()` policy template, `(select ...)` wrapper for performance.**

### Migration 034 — `agents` + `agent_tools` + `agent_partners`

```sql
-- agents: first-class entity, per-org, text channels only
CREATE TYPE public.agent_channel AS ENUM (
  'web_widget', 'whatsapp', 'messenger', 'instagram', 'manychat', 'telegram'
);

CREATE TABLE public.agents (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                TEXT         NOT NULL,
  slug                TEXT         NOT NULL,                  -- partner tool naming: call_partner_<slug>
  description         TEXT,
  system_prompt       TEXT         NOT NULL,                  -- versioned via agent_prompt_versions
  model               TEXT         NOT NULL DEFAULT 'anthropic/claude-haiku-4-5',
  fallback_message    TEXT         NOT NULL DEFAULT 'I cannot help with that right now.',
  max_history         INTEGER      NOT NULL DEFAULT 10,
  kb_scope            TEXT[],                                  -- v2.0: nullable = all org KB; future: subset of document ids/tags
  channel_overrides   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  is_active           BOOLEAN      NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_agents_org_active ON public.agents(organization_id, is_active);
CREATE INDEX idx_agents_org_slug   ON public.agents(organization_id, slug);

CREATE POLICY "agents_select" ON public.agents
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));
CREATE POLICY "agents_insert" ON public.agents
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));
CREATE POLICY "agents_update" ON public.agents
  FOR UPDATE TO authenticated
  USING     (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));
CREATE POLICY "agents_delete" ON public.agents
  FOR DELETE TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- agent_tools: junction granting an agent permission to use a tool_config
CREATE TABLE public.agent_tools (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id        UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  tool_config_id  UUID         NOT NULL REFERENCES public.tool_configs(id) ON DELETE CASCADE,
  -- Channel-specific tool override (e.g. SMS tool available only in WhatsApp agent variant)
  allowed_channels public.agent_channel[],   -- null = all channels
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (agent_id, tool_config_id)
);

ALTER TABLE public.agent_tools ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_agent_tools_agent ON public.agent_tools(agent_id);
CREATE INDEX idx_agent_tools_tool  ON public.agent_tools(tool_config_id);

CREATE POLICY "agent_tools_all" ON public.agent_tools
  FOR ALL TO authenticated
  USING     (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

-- agent_partners: directed edge agent_id → partner_agent_id (cycles prevented at runtime)
CREATE TABLE public.agent_partners (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id          UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  partner_agent_id  UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  invocation_description TEXT,    -- LLM-facing: "Call this when the user needs billing help"
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (agent_id <> partner_agent_id),
  UNIQUE (agent_id, partner_agent_id)
);

ALTER TABLE public.agent_partners ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_agent_partners_agent ON public.agent_partners(agent_id);

CREATE POLICY "agent_partners_all" ON public.agent_partners
  FOR ALL TO authenticated
  USING     (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));
```

### Migration 035 — `agent_prompt_versions`

```sql
CREATE TABLE public.agent_prompt_versions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id        UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  version         INTEGER      NOT NULL,
  system_prompt   TEXT         NOT NULL,
  created_by      UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

ALTER TABLE public.agent_prompt_versions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_agent_prompt_versions_agent ON public.agent_prompt_versions(agent_id, version DESC);

CREATE POLICY "agent_prompt_versions_all" ON public.agent_prompt_versions
  FOR ALL TO authenticated
  USING     (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

-- Trigger: every UPDATE on agents.system_prompt snapshots a new version row
-- (implementation in migration body)
```

### Migration 036 — `agent_channel_defaults` (resolver mapping)

```sql
CREATE TABLE public.agent_channel_defaults (
  id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID                  NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel         public.agent_channel  NOT NULL,
  agent_id        UUID                  NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  UNIQUE (organization_id, channel)
);

ALTER TABLE public.agent_channel_defaults ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_agent_channel_defaults_org ON public.agent_channel_defaults(organization_id, channel);

CREATE POLICY "agent_channel_defaults_all" ON public.agent_channel_defaults
  FOR ALL TO authenticated
  USING     (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));
```

### Migration 037 — `agent_invocations` (observability)

```sql
CREATE TYPE public.agent_invocation_status AS ENUM ('success', 'error', 'partial', 'timeout');

CREATE TABLE public.agent_invocations (
  id                 UUID                              PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID                              NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id           UUID                              NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  parent_invocation_id UUID                            REFERENCES public.agent_invocations(id) ON DELETE SET NULL,
  channel            public.agent_channel              NOT NULL,
  conversation_id    UUID,                             -- conversations.id when applicable
  session_id         TEXT,                             -- ephemeral widget session
  depth              INTEGER                           NOT NULL DEFAULT 0,
  status             public.agent_invocation_status    NOT NULL,
  user_message       TEXT,
  assistant_reply    TEXT,
  tool_calls         JSONB                             NOT NULL DEFAULT '[]'::jsonb,  -- [{tool_name, args, result_summary, ms}]
  partner_calls      JSONB                             NOT NULL DEFAULT '[]'::jsonb,  -- [{partner_agent_id, ms, status}]
  tokens_in          INTEGER,
  tokens_out         INTEGER,
  cost_usd           NUMERIC(10,6),
  model              TEXT,
  duration_ms        INTEGER,
  error_detail       TEXT,
  created_at         TIMESTAMPTZ                       NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_invocations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_agent_invocations_org_created ON public.agent_invocations(organization_id, created_at DESC);
CREATE INDEX idx_agent_invocations_agent       ON public.agent_invocations(agent_id, created_at DESC);
CREATE INDEX idx_agent_invocations_parent      ON public.agent_invocations(parent_invocation_id) WHERE parent_invocation_id IS NOT NULL;

CREATE POLICY "agent_invocations_select" ON public.agent_invocations
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));
-- inserts are service-role-only (runtime writes via createServiceRoleClient)
```

### RLS Policy Template (reused)

```sql
USING     (organization_id = (SELECT public.get_current_org_id()))
WITH CHECK (organization_id = (SELECT public.get_current_org_id()));
```

This is identical to existing `tool_configs`, `integrations`, `conversations`, etc. — no novel RLS surface.

### Index Strategy Summary

| Table | Index | Why |
|-------|-------|-----|
| `agents` | `(organization_id, is_active)` | Dashboard list query |
| `agents` | `(organization_id, slug)` | Partner-tool name lookup |
| `agent_tools` | `(agent_id)` | Hot path — runtime fetches all tools for an agent on every invocation |
| `agent_partners` | `(agent_id)` | Hot path — runtime injects partner tools |
| `agent_channel_defaults` | `(organization_id, channel)` | Inbound resolver — must be sub-ms |
| `agent_invocations` | `(organization_id, created_at DESC)` | Observability list |
| `agent_invocations` | `(parent_invocation_id) WHERE NOT NULL` | Delegation tree reconstruction |

---

## Data Flow

### Inbound message → response (web widget, v2.0)

```
POST /api/chat/[token]
   ↓ (resolve org from widget_token)
   ↓
resolveAgentForChannel(orgId, 'web_widget')   ── new lookup
   ↓ agentId
   ↓
runAgent({ orgId, agentId, channel: 'web_widget', message, history, supabase }, { stream: true })
   ↓ ┌─────────────────────────────────────────┐
     │ 1. loadAgent(agentId, supabase)         │  cached per request
     │ 2. apply channel_overrides[web_widget]  │
     │ 3. fetchAgentTools(agentId)             │  joins agent_tools → tool_configs → integrations
     │ 4. fetchAgentPartners(agentId)          │  → synthetic call_partner_<slug> tools
     │ 5. queryKnowledge(message, orgId)       │  if agent.kb_scope is null/matches
     │ 6. buildSystemPrompt()                  │  base + suffix + KB context
     │ 7. logInvocation('start') → invocationId│
     │ 8. streamChat({systemPrompt,tools,...}) │
     │     ├── LLM emits token → emit + accumulate
     │     ├── LLM emits tool_use
     │     │      ├── if name = call_partner_*  → handleDelegation()
     │     │      │                                 → runAgent(child, {stream:false})
     │     │      │                                 → returns text reply
     │     │      │                                 → re-feeds to parent LLM
     │     │      └── else → executeAction() → result fed back
     │     └── final assistant text → emit + accumulate
     │ 9. logInvocation('complete', metrics)   │
     └─────────────────────────────────────────┘
   ↓
ReadableStream (SSE) → widget
```

### State Management

```
Source of truth (Supabase):
  agents, agent_tools, agent_partners, agent_channel_defaults
  conversations, conversation_messages
  agent_invocations

Per-request cache (Next cache()):
  loadAgent(agentId)         deduped within a render tree
  fetchAgentTools(agentId)   deduped
  resolveAgentForChannel()   deduped

Ephemeral (Redis):
  chat:session:<sessionId>   widget session history (unchanged from v1.2)
```

### Key Data Flows

1. **Cold start of an inbound message:** channel handler → token/secret auth → `resolveAgentForChannel` (1 query) → `runAgent` → in parallel: `loadAgent` (1), `fetchAgentTools` (1), `fetchAgentPartners` (1), `queryKnowledge` (3 — openai key, embed, search) → `streamChat` (LLM streaming).
2. **Partner delegation:** parent LLM emits `call_partner_billing` tool_use → runtime intercepts → recursive `runAgent` with `_depth+1, _callStack+[parentId]` → child returns text via stream-collector → parent LLM receives as tool_result.
3. **Observability write:** at run start `logInvocation('start')` returns id; on completion `logInvocation('complete', {tokens, cost, partner_calls, tool_calls, duration})` updates the row. Writes use `createServiceRoleClient` (no user session in webhook).

---

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| 1-10 orgs (today) | Single Postgres, no caching beyond per-request memo. Agent + tool + partner queries (3) per inbound: ~15ms total. |
| 10-100 orgs | Add `cache()` wrappers on `loadAgent`. Consider denormalizing `agent_tools` + `agent_partners` into `agents.tool_ids[]` / `partner_ids[]` if profiling shows join cost. |
| 100-1k orgs, partner delegation hot | Pre-warm popular agent definitions in Redis (sub-ms cache). Move `agent_invocations` writes to fire-and-forget via `after()` (already pattern in `route.ts`). Consider partitioning `agent_invocations` by `created_at` quarterly. |
| 1k+ orgs | Re-evaluate. Likely not a v2.0 problem. |

### Scaling Priorities

1. **First bottleneck (predicted):** `agent_invocations` insert volume. Every inbound message + every partner call = 1 row. Mitigation already in pattern: fire-and-forget via `after()`.
2. **Second bottleneck (predicted):** partner delegation cost. 2-level deep delegation = 3 LLM calls per user message. Mitigation: agent prompt should explicitly tell the LLM not to over-delegate; depth cap = 2 in v2.0.
3. **Hidden risk:** Embedded chat widget timeouts. KB query + delegation can push response start past 3s. Stream the "thinking" event early (`event: partner_start` is intentionally chatty for this reason).

---

## Anti-Patterns

### Anti-Pattern 1: Forking `stream.ts` into `stream-with-agent.ts`

**What people do:** Leave the existing `createChatStream` alone, write a parallel `createAgentChatStream` for new code, plan to delete the old one "later."
**Why it's wrong:** Two paths fight forever. Bug fixes diverge. v2.0 ships then v1.4 path silently rots until a regression in production.
**Do this instead:** Refactor `createChatStream` to accept `AgentContext`. Provide a one-line shim that constructs a default `AgentContext` from `(orgId, orgName, toolsWithCreds, message)` so anything not yet migrated still compiles. Delete the shim in Phase 5.

### Anti-Pattern 2: Adding `agent_id` to `tool_configs` directly

**What people do:** Add a nullable `tool_configs.agent_id` column and say "null means org-scoped, set means agent-scoped."
**Why it's wrong:** Conflates two relationships (tool *belongs to* org vs tool *granted to* agent). Breaks Vapi's resolver — `resolveTool(orgId, name)` would now need to filter `agent_id IS NULL`. Also blocks many-to-many (one tool granted to multiple agents).
**Do this instead:** Junction table `agent_tools` (above). `tool_configs` stays org-owned; agents *grant* themselves use of a subset.

### Anti-Pattern 3: Calling `runAgent()` synchronously inside webhook receiver

**What people do:** ManyChat webhook receiver awaits `runAgent()` before returning 200.
**Why it's wrong:** ManyChat's External Request has a 10s timeout. Partner delegation + KB + 2 LLM calls can blow that. Receiver becomes flaky.
**Do this instead:** Receiver returns 200 immediately. Use `after(() => runAgent(...))` (Next 15 pattern, already in use for `processMetaEvent`). Reply is sent back to ManyChat via `sendManychatMessage` action (the agent itself emits the reply).

### Anti-Pattern 4: Letting partner agents see the full parent history

**What people do:** Pass parent's `history` array straight into child `runAgent()` call.
**Why it's wrong:** History contains messages addressed to a different agent personality. Child gets confused, also leaks user PII unnecessarily into a specialist that doesn't need it.
**Do this instead:** Build a minimal child context: `{ message: <parent's tool-call args>, history: [] }`. Parent's job is to summarize what it needs from the partner via the `input` of the synthetic tool call.

### Anti-Pattern 5: New "voice agent" type pretending to share runtime

**What people do:** Try to make `runAgent()` work for Vapi too, "for consistency."
**Why it's wrong:** Voice = Vapi's runtime; trying to shoehorn it breaks the milestone scope and re-introduces the coupling we're undoing. Explicitly out of scope per PROJECT.md.
**Do this instead:** Vapi paths stay 100% untouched. `assistant_mappings` and `/api/vapi/tools` keep using `resolveTool(orgId, name)`. The `agents` table is text-only.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| OpenRouter / Anthropic | Per-org keys via `getProviderKey` (existing) | Unchanged. Runtime passes through. |
| Supabase pgvector (KB) | `queryKnowledge(query, orgId)` | Optionally filtered by `agent.kb_scope` in v2.0+ |
| ManyChat | Outbound via `sendManychatMessage` action | Agent reply becomes a tool call to send the message |
| Meta (IG/Messenger) | Outbound via existing `replyMessenger`/`replyInstagram` paths | Same — agent reply triggers the outbound action |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| inbound handler ↔ agent-runtime | direct call: `runAgent(ctx, opts)` | streaming or text mode per channel |
| agent-runtime ↔ chat/stream | direct call: `streamChat(streamParams)` | agent-runtime owns prompt assembly; stream owns LLM I/O |
| agent-runtime ↔ action-engine | `resolveAgentTool(agentId, name)` → `executeAction(...)` | new resolver, same executor |
| agent-runtime ↔ knowledge | `queryKnowledge(query, orgId)` | unchanged; agent decides whether to call it |
| agent A ↔ agent B (delegation) | recursive `runAgent()` with `_depth+1` | in-process, in-band; no event bus |
| dashboard CRUD ↔ agents | server actions in `src/app/(dashboard)/agents/` using `createClient()` | standard RLS-gated path |
| observability ↔ agent-runtime | runtime writes `agent_invocations` rows | fire-and-forget via `after()` |

---

## Tool Scoping Integration (Question 4 detail)

**Decision:** Keep `resolveTool(orgId, toolName)` untouched. Add a sibling `resolveAgentTool(agentId, toolName, supabase)` that:

1. Joins `agent_tools` → `tool_configs` → `integrations`.
2. Filters by `agent_id = $1 AND tool_configs.tool_name = $2 AND is_active`.
3. Returns the same `ToolConfigWithIntegration` shape (so `executeAction` is unchanged).

```typescript
// src/lib/action-engine/resolve-agent-tool.ts
export async function resolveAgentTool(
  agentId: string,
  toolName: string,
  supabase: SupabaseClient<Database>
): Promise<ToolConfigWithIntegration | null> {
  const { data } = await supabase
    .from('agent_tools')
    .select('tool_configs!inner(*, integrations!inner(*))')
    .eq('agent_id', agentId)
    .eq('tool_configs.tool_name', toolName)
    .eq('tool_configs.is_active', true)
    .single()
  // shape-massage to ToolConfigWithIntegration
}
```

**Vapi keeps using `resolveTool`** because Vapi's webhook has no agent_id — it's identified by `vapi_assistant_id` (different abstraction, kept isolated).

**Bulk fetch** (used at runtime start, not per tool call): `fetchAgentTools(agentId, supabase)` returns the full `ToolWithCredentials[]` array for the agent — replaces the inline fetch in `src/app/api/chat/[token]/route.ts` lines 122-166.

---

## Channel-Agnostic Invocation (Question 6 detail)

### Web widget (`src/app/api/chat/[token]/route.ts`)

**Before (v1.4):** Resolve org → fetch tools → build `ToolWithCredentials[]` → call `createChatStream(...)`.

**After (v2.0):**
```typescript
const agentId = await resolveAgentForChannel(org.id, 'web_widget', supabase)
const result = await runAgent({
  orgId: org.id, agentId, channel: 'web_widget',
  conversationId: ctx.dbSessionId, sessionId,
  message, history: ctx.messages.slice(-10),
  supabase,
}, { stream: true, onReplyChunk: c => { accumulatedReply += c } })
return new Response((result as { stream: ReadableStream }).stream, { headers: { ... } })
```

Net diff: ~30 lines deleted (inline tool fetch + integration join), ~10 lines added. Pre-existing `after()` persist hooks stay.

### ManyChat (`src/lib/manychat/dispatch-event.ts`)

**Current behavior:** ManyChat events match a *rule* → bound *tool_config* → executed directly. No LLM involvement.

**v2.0 option:** Add a new "agent dispatch" rule type. If a matched rule has `agent_id` instead of `tool_config_id`, dispatcher calls `runAgent({...channel: 'manychat', message: <text from payload>, ...}, {stream: false})` and the agent's reply is sent back via `sendManychatMessage`.

```typescript
// src/lib/manychat/dispatch-event.ts (sketch of new branch)
if (rule.agent_id) {
  const { reply } = await runAgent({
    orgId: input.orgId, agentId: rule.agent_id, channel: 'manychat',
    conversationId: input.eventId, message: extractText(input.payload),
    history: [], supabase, metadata: input.payload,
  }, { stream: false })
  // reply goes back via the manychat reply pipeline (existing)
}
```

Schema delta: `manychat_rules.agent_id UUID NULL REFERENCES agents(id)` (XOR with `tool_config_id`).

### Meta (`src/lib/meta/process-event.ts`)

Currently dispatches by `automation_id`. Add `meta_channels.agent_id UUID NULL`. If set, after persisting the inbound message, call `runAgent({channel: instagram|messenger, ...}, {stream: false})` and reply via the existing outbound action.

### Net refactor footprint per handler

| Handler | Lines added | Lines removed | Risk |
|---------|------------:|--------------:|------|
| `api/chat/[token]/route.ts` | ~15 | ~50 (inline tool fetch removed) | LOW — wraps existing primitive |
| `manychat/dispatch-event.ts` | ~25 (new branch) | 0 | LOW — additive |
| `meta/process-event.ts` | ~25 | 0 | LOW — additive |
| `api/vapi/tools/route.ts` | 0 | 0 | NONE — out of scope |

---

## Build Order

> Each phase's "starts when" dependency is explicit. A phase can begin in parallel with the previous one if no hard dependency is listed.

### Phase A — Schema foundation
- Migrations 034, 035, 036
- Regenerate `src/types/database.ts`
- Seed: for each existing org, create one default "Main Agent" row (system_prompt = current hardcoded `chat/stream.ts` template) and one `agent_channel_defaults(web_widget → main agent)` row
- **Starts when:** v2.0 milestone kickoff
- **Ships:** schema in remote DB

### Phase B — Agent runtime (text mode only, no delegation)
- `src/lib/agent-runtime/{registry,resolve,system-prompt,tool-set,types}.ts`
- `src/lib/action-engine/resolve-agent-tool.ts`
- `runAgent()` with `{stream: false}` path working end-to-end
- Unit tests against seeded "Main Agent"
- **Starts when:** Phase A ships
- **Ships:** importable runtime, no UI yet

### Phase C — chat/stream.ts refactor + widget integration
- Refactor `createChatStream` → `streamChat(AgentContext)`
- Implement `runAgent` `{stream: true}` path using `streamChat`
- Migrate `src/app/api/chat/[token]/route.ts` to use `runAgent`
- Smoke test: widget continues working using seeded default agent
- **Starts when:** Phase B ships
- **Ships:** widget on agent runtime (backward-compat preserved)

### Phase D — Agent CRUD dashboard
- `/dashboard/agents` list + create + edit
- Form: name, slug, prompt, model, tools (multi-select from org tools), channel overrides JSONB editor
- Channel default mapper
- **Starts when:** Phase A ships (does not need runtime running)
- **Ships:** admin can create + edit agents

### Phase E — ManyChat + Meta integration
- Add `agent_id` columns to `manychat_rules` + `meta_channels` (migrations 038, 039)
- Update dispatchers to branch on agent_id
- Outbound reply path
- **Starts when:** Phase C ships
- **Ships:** WhatsApp/Meta/ManyChat use agents

### Phase F — Multi-agent delegation
- `src/lib/agent-runtime/{partner-tool,delegation}.ts`
- Synthetic tool injection in `tool-schemas.ts`
- Loop + depth guards
- SSE events: `partner_start`, `partner_done`
- Dashboard UI: partner selector on agent edit page
- **Starts when:** Phase C ships
- **Ships:** agents can call partner agents

### Phase G — Observability
- Migration 037
- `src/lib/agent-runtime/observability.ts` — `logInvocation()` start/complete
- `/dashboard/agents/[id]/invocations` — list view, delegation tree view
- Cost/latency rollup widgets on agent detail page
- **Starts when:** Phase B ships (can write rows immediately, UI can wait)
- **Ships:** per-agent metrics + delegation traces

### Phase H — Playground
- `/dashboard/agents/[id]/playground` — multi-channel selector, send messages, see response + invocation trace inline
- Uses `runAgent` with a synthetic conversation id
- **Starts when:** Phase F ships
- **Ships:** test harness for prompt iteration

### Phase I — Prompt versioning UX
- Migration 035 already shipped in A; this phase adds the trigger + UI
- Snapshot on every edit, view diff, restore
- **Starts when:** Phase D ships
- **Ships:** prompt history with rollback

### Dependency Diagram

```
A (schema) ─────┬─────► B (runtime) ─► C (widget refactor) ─┬─► E (manychat/meta)
                │                                            └─► F (delegation) ─► H (playground)
                ├─────► D (CRUD UI) ─► I (versioning)
                │
                └─────► (Phase G observability runs concurrent w/ B onwards)
```

---

## Backward Compatibility Plan (Question 8)

### Day 0 (Phase A ships)
- Migrations create tables, **seed a default Main Agent for every existing org**.
- `agent_channel_defaults(web_widget)` is populated for every org.
- Nothing else changes — widget still uses old `createChatStream` code path.

### Day 1 (Phase C ships)
- `api/chat/[token]/route.ts` switches to `runAgent`.
- For any org without explicit agent customization, the seeded Main Agent provides the same hardcoded prompt as before (verbatim copy of v1.4 template), same tool list (all active org tools attached via `agent_tools` seed), same KB behavior (`kb_scope: null` = all).
- Behavior is **byte-identical** for legacy orgs.
- A feature flag is **not needed** because the migration path is "every org always has an agent."

### Edge cases
- **Org with no agent row (impossible after seed but defensive):** `resolveAgentForChannel` returns null → `runAgent` short-circuits → emit `DEGRADATION_MESSAGE` (same as current behavior when no provider keys).
- **Tool exists in org but not granted to agent:** Tool absent from agent's LLM tool list. LLM cannot call it. Existing tools in legacy orgs are auto-granted via seed.
- **Tool added to org after agent creation:** Does NOT auto-attach to existing agents. Admin must explicitly grant. This is intentional — keeps agent scope predictable.
- **Vapi:** Untouched. `assistant_mappings`, `/api/vapi/tools`, `resolveTool(orgId, name)` work exactly as today.

### Rollback plan
- Migrations are additive (new tables, no destructive changes to existing tables until Phase E columns).
- If Phase C ships and breaks, revert the `route.ts` change — `createChatStream` is preserved as a shim until Phase F. Old path is one git revert away.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------:|------------|
| `stream.ts` refactor breaks an obscure widget code path | MED | Keep `createChatStream` shim alive through Phase F; full smoke against widget in staging |
| Partner delegation cost spikes (LLM call amplification) | MED | Hard cap depth=2, max-partners-per-turn=3, per-org daily token budget alert |
| Per-channel overrides JSONB drift (schema-less merge bugs) | MED | Zod parser + DB CHECK constraint on JSON shape; reject invalid on write |
| `agent_invocations` write volume | LOW | `after()` fire-and-forget; partition by quarter if needed |
| Vapi accidentally affected | LOW | Explicit non-touch policy in code review; no Vapi files in PR diffs for v2.0 |
| Seeded "Main Agent" prompt drift from v1.4 hardcoded prompt | MED | Seed migration copies the literal string from `stream.ts`; test asserts exact match |

---

## Sources

- Direct read: `src/lib/chat/stream.ts`, `stream/tool-schemas.ts`, `stream/anthropic.ts`, `chat/session.ts`
- Direct read: `src/lib/action-engine/resolve-tool.ts`, `execute-action.ts`
- Direct read: `src/lib/knowledge/query-knowledge.ts`
- Direct read: `src/app/api/chat/[token]/route.ts`, `src/app/api/manychat/webhook/route.ts`, `src/app/api/meta/webhook/route.ts`
- Direct read: `src/lib/meta/process-event.ts`, `src/lib/manychat/dispatch-event.ts`
- Direct read: `supabase/migrations/001_foundation.sql` (RLS policy template + `get_current_org_id()`)
- Project doc: `.planning/PROJECT.md` (v2.0 milestone scope)
- Seed doc: `.planning/seeds/SEED-002-multi-bot-platform.md`
- Project conventions: `CLAUDE.md` (auth cached helpers, RLS, Node.js runtime, AES-256-GCM)

---
*Architecture research for: v2.0 Multi-Bot Platform (chat-side agent abstraction)*
*Researched: 2026-05-15*

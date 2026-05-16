# Phase 34 Research — Agent Runtime Skeleton + Day-1 Guardrails

**Phase:** 34  
**Researched:** 2026-05-16  
**Status:** COMPLETE — all locked decisions in 34-CONTEXT.md sourced from findings below

---

## 1. Existing LLM Provider Abstraction

### anthropic.ts pattern (`src/lib/chat/stream/anthropic.ts`)

The Anthropic path instantiates `new Anthropic({ apiKey })` from `@anthropic-ai/sdk ^0.82.0` and calls `client.messages.stream(params)` which returns an async iterable of typed events. The current flow:

1. Build `Anthropic.MessageParam[]` from history window + current message
2. Call `client.messages.stream({ model, max_tokens, system, messages, tools? })`
3. Iterate events: `content_block_start` for tool-use detection, `content_block_delta` for token streaming
4. Call `msgStream.finalMessage()` to get the complete message after streaming
5. If `stop_reason === 'tool_use'`, dispatch via `executeAction()`, then re-call `client.messages.stream` with tool result appended — single tool round-trip only (no loop)

Key interface:

```ts
interface StreamAnthropicParams {
  apiKey: string
  systemPrompt: string
  historyWindow: Array<{ role: 'user' | 'assistant'; content: string }>
  message: string
  tools: Anthropic.Tool[]
  toolsWithCreds: ToolWithCredentials[]
  orgId: string
  supabase: SupabaseClient<Database>
  emit: (obj: object) => void
  onReplyChunk: (chunk: string) => void
}
```

Model hardcoded to `'claude-3-5-haiku-20241022'` in current implementation — Phase 34 runtime will read `agents.model` dynamically.

### openrouter.ts pattern (`src/lib/chat/stream/openrouter.ts`)

Uses `openai ^6.33.0` with `baseURL: 'https://openrouter.ai/api/v1'`. Identical structural pattern: stream creation, delta accumulation, single tool round-trip via `executeAction`, second stream for final reply. Tool call arguments accumulate across delta chunks (streamed JSON fragments must be concatenated before `JSON.parse`).

### Provider selection logic (`src/lib/chat/stream.ts`)

`getProviderKey(provider, orgId, supabase)` fetches + decrypts from `integrations` table. OpenRouter is preferred (checked first); Anthropic is fallback. Both can be absent — graceful degradation emits a static message. The Phase 34 runtime needs the same key-resolution approach via `getProviderKey` from `src/lib/integrations/get-provider-key.ts`.

The `ai` package (Vercel AI SDK) is **NOT currently installed** — it does not appear in `package.json`. Installing it is the explicit spike task in Plan 01.

---

## 2. `execute-action.ts` Tool Dispatch Pattern

`executeAction(actionType, params, credentials, ctx?)` is a pure dispatcher in `src/lib/action-engine/execute-action.ts`. Interface:

```ts
export interface ActionContext {
  organizationId: string
  supabase: SupabaseClient<Database>
  toolConfig?: Json          // required for custom_webhook
  integrationProvider?: IntegrationProvider  // routes send_sms to Twilio vs GHL
}

export async function executeAction(
  actionType: ActionType,       // DB enum value
  params: Record<string, unknown>,
  credentials: GhlCredentials,  // { apiKey: string; locationId: string }
  ctx?: ActionContext
): Promise<string>              // always returns a string tool-result
```

Supports: `create_contact`, `get_availability`, `create_appointment`, `knowledge_base`, `google_contacts_create/update/find/delete`, `send_sms`, `custom_webhook`, `manychat_set_field/add_tag/trigger_flow/send_message`.

TypeScript exhaustiveness check (`never` default case) — adding a new `action_type` enum value without a case will be a compile error. Phase 34 does not add new action types.

The Phase 34 runtime calls `executeAction` identically to how `streamAnthropic` and `streamOpenRouter` call it, but wrapped with the tool-attached guard (D-34-14): if `resolveAgentTool(agentId, toolName)` returns `null`, synthesize a denial result instead of calling `executeAction`.

### `resolveTool` (existing, unchanged)

```ts
resolveTool(orgId: string, toolName: string, supabase): Promise<ToolConfigWithIntegration | null>
```

Queries `tool_configs` with `integrations!inner(*)` join. Returns credentials + config in one DB call. D-34-07 mandates this signature is NOT modified in Phase 34.

### `resolveAgentTool` (new in Phase 34)

New file: `src/lib/agent-runtime/resolve-agent-tool.ts`. Must query `agent_tools` joined to `tool_configs` + `integrations` filtering on `(agent_id, tool_name)`. Returns `ToolConfig | null`. Should also check `agent_tools.allowed_channels` if non-null (intersection with invocation channel).

---

## 3. `ai@^6` Spike Assessment

**Current state:** The `ai` package (Vercel AI SDK) is absent from `package.json`. The codebase uses `@anthropic-ai/sdk ^0.82.0` directly (Anthropic native streaming API) and `openai ^6.33.0` pointing at OpenRouter.

**Spike success criterion (from D-34-01):** `generateText`/`streamText` integrates cleanly touching ≤2 files and passing the same unit tests.

**Pre-spike analysis — friction points to validate:**

1. **AbortController propagation:** `generateText` from `ai` accepts an `abortSignal` option. The 8s per-turn budget in Phase 34 creates the controller in the runtime, not inside the LLM call — this should pass cleanly as a signal. Needs verification that `@ai-sdk/anthropic` (the ai SDK provider package) correctly forwards `abortSignal` to `client.messages.stream`.

2. **Multi-provider routing:** `ai` SDK uses provider-specific packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`). The current codebase holds one Anthropic key OR one OpenRouter key per org, resolved at runtime. The ai SDK would need `wrapLanguageModel` or dynamic provider selection — not trivial if both provider packages must be installed.

3. **Tool call handling:** `generateText` returns `toolCalls` and supports `maxSteps` for automatic tool round-trips. This is architecturally different from the current manual two-pass pattern. Wrapping `executeAction` as ai SDK tools requires defining `execute` functions per tool — possible but touches more than 2 files if all action types are wrapped.

4. **Token usage shape:** `generateText` returns `usage: { promptTokens, completionTokens }` — maps directly to `tokens_in`/`tokens_out` for the invocation write. Cleaner than extracting from `finalMessage()`.

5. **Streaming return (Phase 35):** `streamText` returns `AsyncIterable<TextStreamPart>` which maps to Phase 35's streaming overload requirement. Adopting `ai` now avoids a rewrite in Phase 35.

**Recommendation for spike:** Install `ai@^6` + `@ai-sdk/anthropic`. Test `generateText` with a stubbed tool against the guardrail harness. If `abortSignal` passes and `maxSteps` can be capped at `MAX_LLM_CALLS_PER_TURN`, adopt. If provider-package installation conflicts with existing `openai ^6.33.0` (which OpenRouter uses), stay custom.

**Decision must be documented in the Phase 34 plan verifier. No "undecided" state past Phase 34.**

---

## 4. `agent_invocations` Schema

From migration `037_agent_invocations.sql`:

```sql
CREATE TABLE public.agent_invocations (
  id                   UUID                           PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID                           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id             UUID                           NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_invocation_id UUID                           REFERENCES agent_invocations(id) ON DELETE SET NULL,
  trace_id             UUID                           NOT NULL,
  channel              public.agent_channel           NOT NULL,
  conversation_id      UUID,
  session_id           TEXT,
  depth                INTEGER                        NOT NULL DEFAULT 0,
  status               public.agent_invocation_status NOT NULL,
  mode                 public.agent_invocation_mode   NOT NULL DEFAULT 'production',
  user_message         TEXT,
  assistant_reply      TEXT,
  tool_calls           JSONB                          NOT NULL DEFAULT '[]',
  partner_calls        JSONB                          NOT NULL DEFAULT '[]',
  tokens_in            INTEGER,
  tokens_out           INTEGER,
  cost_usd             NUMERIC(10,6),
  model                TEXT,
  duration_ms          INTEGER,
  error_detail         TEXT,
  created_at           TIMESTAMPTZ                    NOT NULL DEFAULT now()
)
```

**Enums:**
- `agent_invocation_status`: `'success' | 'error' | 'aborted' | 'skipped' | 'denied'`
- `agent_invocation_mode`: `'production' | 'playground'`

**Write timing (D-34-03):**

INSERT at START — required non-null columns:
- `organization_id`, `agent_id`, `trace_id`, `channel`, `depth`, `status` (='running' — not in enum; use `'error'` as initial or add `'running'` — see note below), `mode`, `user_message`

Note: The enum has no `'running'` value. The Phase 34 decision says INSERT with `status='running'` — this requires either adding `'running'` to the enum in migration 042, or using a different initial status. Given the CONTEXT.md wording this was an intended addition. Migration 042 should add `'running'` to the enum.

UPDATE at END — fills:
- `assistant_reply`, `tool_calls`, `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`, `status` (final), `error_detail`

**RLS:** SELECT-only for authenticated users. INSERT/UPDATE are service-role only — `invocations.ts` must use `createServiceRoleClient()` from `src/lib/supabase/admin.ts`.

**action_logs cross-reference (OBS-02):** The `action_logs` table now has `agent_invocation_id UUID` and `trace_id UUID` columns (also added in 037). Phase 34's `executeAction` calls inside the agent runtime should propagate `trace_id` so action log rows can be correlated.

---

## 5. `agent_model_pricing` Cost Computation

From migration `038_tool_idempotency_and_pricing.sql`:

```sql
CREATE TABLE public.agent_model_pricing (
  model             TEXT          PRIMARY KEY,   -- e.g. 'anthropic/claude-sonnet-4-6'
  source            TEXT          NOT NULL,
  input_per_1m_usd  NUMERIC(10,4) NOT NULL,
  output_per_1m_usd NUMERIC(10,4) NOT NULL,
  notes             TEXT,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
)
```

**Seeded models (rates as of 2026-05-16):**

| model | input/1M | output/1M |
|---|---|---|
| `anthropic/claude-opus-4-7` | $15.00 | $75.00 |
| `anthropic/claude-sonnet-4-6` | $3.00 | $15.00 |
| `anthropic/claude-haiku-4-5` | $0.80 | $4.00 |
| `openai/gpt-4o` | $2.50 | $10.00 |
| `openai/gpt-4o-mini` | $0.15 | $0.60 |
| `google/gemini-2.5-pro` | $1.25 | $5.00 |
| `google/gemini-2.5-flash` | $0.075 | $0.30 |

**Cost formula (D-34-15):**

```ts
cost_usd = (tokens_in / 1_000_000 * pricing.input_per_1m_usd)
         + (tokens_out / 1_000_000 * pricing.output_per_1m_usd)
```

If no matching row for `agents.model`, set `cost_usd = null` and emit structured warning log — do not fail the invocation.

**Daily cost check query:**

```sql
SELECT COALESCE(SUM(cost_usd), 0)
FROM agent_invocations
WHERE organization_id = $orgId
  AND created_at >= NOW() - INTERVAL '24 hours'
  AND cost_usd IS NOT NULL
```

Compared against `organizations.daily_cost_cap_usd_override ?? env.AGENT_DAILY_COST_CAP_USD ?? 50.00`.

No RLS on `agent_model_pricing` — global reference table, readable without auth context. Use `createServiceRoleClient()` for the join inside the runtime.

---

## 6. AbortController Patterns in Codebase

The codebase has five distinct AbortController usages across three patterns:

**Pattern A — Timeout-then-abort (most common):**

```ts
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), N_MS)
try {
  const response = await fetch(url, { signal: controller.signal, ... })
  return response
} finally {
  clearTimeout(timeoutId)
}
```

Used in: `src/lib/ghl/client.ts` (400ms), `src/lib/manychat/client.ts` (5000ms), `src/lib/meta/send-message.ts` (10000ms), `src/lib/custom-webhook/execute-webhook.ts` (10000ms).

**Pattern B — AbortError catch:**

```ts
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'Meta API timeout' }
  }
  return { error: String(err) }
}
```

Used in `send-message.ts`. The runtime needs the same abort detection to set `status='aborted'` and persist the partial reply.

**Pattern C — Signal propagation (needed for Phase 34):**

The runtime creates one `AbortController` per `runAgent` invocation with an 8s budget. This signal must propagate to:
- The LLM SDK call (Anthropic `client.messages.stream` does NOT natively accept `AbortSignal` in the stream params, but the `@anthropic-ai/sdk` does support `signal` via the request options second parameter: `client.messages.stream(params, { signal: controller.signal })`)
- If `ai@^6` is adopted: `generateText(..., { abortSignal: controller.signal })`

**Implementation shape for Phase 34:**

```ts
// in run-agent.ts
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), AGENT_TURN_TIMEOUT_MS)
// pass controller.signal to LLM call
// catch AbortError → set status='aborted', persist partial reply
// finally: clearTimeout(timeoutId)
```

The `AGENT_RUNTIME_ENABLED=false` kill switch is separate — checked BEFORE the AbortController is created and returns immediately without creating DB rows.

---

## 7. Environment Variables

### Existing (already in `.env.local.example` or referenced in code)

| Var | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all Supabase clients |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `createClient()` (server) |
| `SUPABASE_SERVICE_ROLE_KEY` | `createServiceRoleClient()` — runtime invocation writes |
| `ENCRYPTION_SECRET` | `crypto.ts` — decrypt provider API keys |

### New (Phase 34 adds)

| Var | Default | Purpose |
|---|---|---|
| `AGENT_RUNTIME_ENABLED` | `true` | Kill switch (GATE-03). `false` → all `runAgent` calls return 503-graceful immediately |
| `AGENT_DAILY_COST_CAP_USD` | `50.00` | Default per-org daily $ cap when `organizations.daily_cost_cap_usd_override` is NULL |
| `AGENT_MAX_DELEGATION_DEPTH` | `2` | Cap for the delegation depth guard stub (RUNTIME-04) |
| `AGENT_MAX_LLM_CALLS_PER_TURN` | `6` | Cap for LLM call loop guard (RUNTIME-05) |
| `AGENT_MAX_CONV_TOKENS` | `200000` | Per-conversation cumulative token cap (RUNTIME-06) |
| `AGENT_TURN_TIMEOUT_MS` | `8000` | AbortController budget per `runAgent` call (RUNTIME-03) |

All new vars are runtime-only (no `NEXT_PUBLIC_` prefix — never exposed to browser). Read via `process.env` in `src/lib/agent-runtime/guardrails.ts`. Use `parseInt`/`parseFloat` with a documented fallback for numeric vars.

Note: `AGENT_DAILY_COST_CAP_USD` env var name is used when `organizations.daily_cost_cap_usd_override IS NULL`. This is the platform-wide default, not per-org. Org-level override lives in the DB column per D-34-05.

---

## 8. TypeScript Type Shapes

These shapes are locked by D-34-02 and the CONTEXT.md decisions. File: `src/lib/agent-runtime/types.ts`.

### `AgentRunResult` (D-34-02 — exact shape from CONTEXT.md)

```ts
export type AgentRunResult = {
  text: string
  usage: { tokensIn: number; tokensOut: number }
  invocationId: string
  traceId: string
  status: 'success' | 'error' | 'aborted' | 'denied' | 'skipped'
  errorDetail?: string
}
```

Phase 35 extends with `stream: true` overload returning `AsyncIterable<string>`. Phase 34 does NOT ship the streaming overload.

### `AgentRunContext`

Represents the resolved invocation context — built before `runAgent` makes any LLM calls.

```ts
export type AgentRunContext = {
  // Invocation identity
  orgId: string
  agentId: string
  channel: AgentChannel              // 'web_widget' | 'whatsapp' | 'messenger' | 'instagram' | 'manychat' | 'telegram'
  conversationId?: string
  sessionId?: string
  traceId: string                    // UUID, generated at call site before INSERT
  mode: 'production' | 'playground'

  // Delegation guard (D-34-10 stub)
  _depth: number                     // 0 for top-level calls; Phase 38 increments

  // Resolved agent fields (after channel_overrides applied)
  systemPrompt: string               // from agent_prompt_versions via active_prompt_version_id
  model: string                      // agents.model (or channel_override)
  temperature?: number               // channel_override or undefined (SDK default)
  maxTokens: number                  // agents.max_tokens or channel_override
  maxHistory: number                 // agents.max_history or channel_override
  fallbackMessage: string            // agents.fallback_message
  allowedChannels: AgentChannel[]    // agents.allowed_channels

  // Conversation input
  userMessage: string
  historyWindow: Array<{ role: 'user' | 'assistant'; content: string }>
}
```

`AgentChannel` is the TypeScript projection of `public.agent_channel` enum. Extract from `Database['public']['Enums']['agent_channel']` or define as a literal union matching the DB enum.

### `AgentRunOptions`

Options the call site passes to `runAgent`:

```ts
export type AgentRunOptions = {
  orgId: string
  agentId: string
  channel: AgentChannel
  userMessage: string
  conversationId?: string
  sessionId?: string
  historyWindow?: Array<{ role: 'user' | 'assistant'; content: string }>
  mode?: 'production' | 'playground'
  _depth?: number                    // internal; Phase 38 sets this for recursive calls
  parentInvocationId?: string        // internal; Phase 38 sets this for recursive calls
}
```

`runAgent` accepts `AgentRunOptions`, resolves the agent row (applying channel overrides), builds `AgentRunContext`, then executes the guarded loop. The supabase client is not passed in options — the runtime creates `createServiceRoleClient()` internally.

---

## 9. Migration 042 — `organizations.daily_cost_cap_usd_override`

**File:** `supabase/migrations/042_org_daily_cost_cap.sql`

**Previous migration on disk:** `041_ghl_inbound.sql` (Phase 999.1 backlog). 042 is the next slot (D-34-16).

**Required SQL:**

```sql
-- =============================================================================
-- Migration: 042_org_daily_cost_cap
-- Phase: v2.0 Phase 34 — Agent Runtime Skeleton + Day-1 Guardrails
-- Adds:    organizations.daily_cost_cap_usd_override NUMERIC(8,2) NULL
-- Decisions: D-34-05
-- No RLS change: organizations table RLS from 001_foundation already covers this column.
-- No UI in Phase 34: set via direct DB edit or Phase 36 settings panel.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS daily_cost_cap_usd_override NUMERIC(8,2) NULL;

COMMENT ON COLUMN public.organizations.daily_cost_cap_usd_override IS
  'Phase 34 (v2.0): per-org daily agent cost cap override in USD. NULL = use AGENT_DAILY_COST_CAP_USD env var (default $50.00). Non-null = use this org-specific cap. Enforced by the agent runtime guardrails.ts before each invocation.';
```

**Usage in guardrails.ts:**

```ts
const capUsd = org.daily_cost_cap_usd_override
  ?? parseFloat(process.env.AGENT_DAILY_COST_CAP_USD ?? '50.00')
```

**Note on `'running'` enum value:** The CONTEXT.md specifies INSERT with `status='running'` but the `agent_invocation_status` enum in 037 does not include `'running'`. Migration 042 should also add this value:

```sql
ALTER TYPE public.agent_invocation_status ADD VALUE IF NOT EXISTS 'running';
```

This resolves the type mismatch before Phase 34 plan execution. If `'running'` is intentionally excluded from the enum (orphan rows are detected by `duration_ms IS NULL AND status != 'success/error/aborted'`), the initial INSERT should use `'error'` as a safe placeholder and UPDATE to the real status on completion. The plan executor should make this call explicit.

---

## Additional Findings

### `agent_prompt_versions` join pattern (D-34-06)

The runtime must resolve the prompt via `active_prompt_version_id`, not `agents.system_prompt` directly:

```sql
SELECT apv.system_prompt
FROM agents a
JOIN agent_prompt_versions apv ON a.active_prompt_version_id = apv.id
WHERE a.id = $agentId AND a.organization_id = $orgId
```

All Phase 33-seeded agents have `active_prompt_version_id` set (migration 040 does the UPDATE-after-INSERT). Agents created before Phase 33 migrations ran would have NULL — guard: if `active_prompt_version_id IS NULL`, log a structured warning and use `agents.system_prompt` as fallback. Do not fail the invocation.

### `channel_overrides` deep-merge (D-34-11)

Mergeable fields: `system_prompt` (suffix-append only), `model`, `temperature`, `max_tokens`, `max_history`. The merge happens in `resolve-agent.ts` before building `AgentRunContext`. Unknown keys in the JSONB are silently ignored.

```ts
// system_prompt suffix-append (NOT replace):
resolved.systemPrompt = base.systemPrompt + '\n\n' + override.system_prompt
```

### `allowed_channels` denial (D-34-12, D-34-13)

No invocation row is written for denied calls. The denial check happens in `run-agent.ts` before any DB write or LLM call. The invocation returns `AgentRunResult` with `status='denied'`, `text=agent.fallback_message`, `invocationId=''` (no row was created), `traceId` still generated for call-site logging.

### Tool call guard (D-34-14)

Denied tool calls ARE recorded in `agent_invocations.tool_calls` JSONB:

```json
[{ "name": "some_tool", "args": {...}, "denied": true, "denied_reason": "tool_not_attached_to_agent" }]
```

The invocation itself is not aborted — the LLM receives the denial as a tool result and continues the turn.

### Service role client for runtime writes

`src/lib/supabase/admin.ts` exports `createServiceRoleClient()`. Phase 34 runtime must use this (not the user-scoped `createClient()`) for:
- Reading `agents` + `agent_prompt_versions` (bypasses RLS — needed because runtime runs in background context without a user session cookie)
- Reading `agent_model_pricing` (no RLS but service role is consistent)
- Reading `organizations.daily_cost_cap_usd_override`
- Writing `agent_invocations` (RLS explicitly blocks authenticated INSERT)
- Reading `agent_tools` + `tool_configs` + `integrations` for `resolveAgentTool`

---

## RESEARCH COMPLETE

---

## ai@^6 Spike Decision

**Date:** 2026-05-16
**Result:** ADOPT
**Rationale:** All five friction points passed. `generateText` and `streamText` accept `abortSignal` as a top-level option, and `@ai-sdk/anthropic` explicitly forwards it to the underlying Anthropic stream (confirmed in dist/index.js source). The `maxSteps` parameter from older SDK versions is replaced by `stopWhen: stepCountIs(N)` in v6, which serves as the `AGENT_MAX_LLM_CALLS_PER_TURN` cap with equivalent semantics. Tool wrapping via the `tool()` helper is self-contained inside `run-agent.ts` — no changes needed to `execute-action.ts` or any action type files, staying within the ≤2 files threshold. `@ai-sdk/anthropic` has no dependency on `@ai-sdk/openai` and introduces no conflicts with the existing `openai ^6.33.0` (OpenRouter path). Usage shape uses `inputTokens` and `outputTokens` which map directly to `tokens_in`/`tokens_out`.

**Impact on Wave 2/3 plans:**
- run-agent.ts LLM call: uses `generateText` from 'ai' with `@ai-sdk/anthropic` provider
- Provider selection: Anthropic path uses `@ai-sdk/anthropic`; OpenRouter path continues using `openai ^6.33.0` with `baseURL` override (no `@ai-sdk/openai` needed in Phase 34 — OpenRouter is secondary path, Anthropic is primary)
- AbortController: `generateText({ abortSignal: controller.signal })` — the 8s per-turn budget propagates to the underlying Anthropic stream
- LLM call cap: `stopWhen: stepCountIs(AGENT_MAX_LLM_CALLS_PER_TURN)` passed to `generateText`
- Tool execution: `tool({ description, parameters, execute: async (args) => resolveAgentTool(...) + executeAction(...) })` — all tool wrapping stays in run-agent.ts

**Version pinned:** ai@6.0.184 + @ai-sdk/anthropic@3.0.78

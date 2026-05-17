---
phase: 34
name: Agent Runtime Skeleton + Day-1 Guardrails
milestone: v2.0
status: planning
discuss_completed: 2026-05-16
---

# Phase 34: Context + Locked Decisions

## Phase Goal

A single `runAgent(ctx, opts)` entry point in `src/lib/agent-runtime/` is the **only** way chat-side code invokes an LLM. Every cost, loop, timeout, and kill-switch guard ships in this phase — not deferred. Every invocation writes exactly one `agent_invocations` row with full cost/latency/trace data. The `ai@^6` adoption decision is locked here via spike.

## Requirements in Scope

AGENT-04, AGENT-05, AGENT-06, AGENT-07, AGENT-10, TOOL-05, TOOL-06, RUNTIME-01..10, GATE-03

## Out of Scope (Phase 34 boundary — do not implement)

- Streaming return from `runAgent` → Phase 35 (web widget cutover)
- Wiring `runAgent` into any live channel handler → Phase 35 (web widget) / Phase 37 (ManyChat/Meta)
- Delegation recursion (`call_partner_<slug>` injection, partner invocation) → Phase 38
- CRUD dashboard for agents → Phase 36
- Playground mode (`mode='playground'`) → Phase 39
- Idempotency wrappers inside executors → Phase 38
- DB trigger for auto-versioning on `agents.system_prompt` update → Phase 41
- Channel adapter formatting modules → Phase 37

## Locked Decisions

### D-34-01: ai@^6 Spike

**Decision:** Spike `ai@^6` (Vercel AI SDK v6) in Phase 34 as the first plan. Budget: ≤1 day.

**Spike success criterion:** `generateText` / `streamText` integrates cleanly at the `runAgent` call site without restructuring `AgentRunContext`, guardrails, or the invocation write path. "Drop-in" means the spike touches ≤2 files and passes the same unit tests.

**Outcome paths:**
- **Adopt:** If drop-in fits, import `generateText` from `ai` and remove the custom HTTP client in the runtime. Document the adopted version in the plan verifier output.
- **Stay custom:** If the spike reveals incompatibilities (type mismatch on AbortController propagation, streaming shape divergence, >1 day cost), close the spike branch and build the custom orchestrator directly. Document the reason in the verifier.

**Phase 34 must ship with a decision either way. No "undecided" state is allowed past Phase 34.**

### D-34-02: `runAgent` Return Type (Phase 34 shape)

**Decision:** `runAgent` returns `Promise<AgentRunResult>` — a plain object, NOT a stream.

```ts
type AgentRunResult = {
  text: string
  usage: { tokensIn: number; tokensOut: number }
  invocationId: string
  traceId: string
  status: 'success' | 'error' | 'aborted' | 'denied' | 'skipped'
  errorDetail?: string
}
```

Phase 35 will extend the signature with a `stream: true` overload that returns `AsyncIterable<string>` for the SSE path. Phase 34 does NOT ship the streaming overload.

Each channel handler owns its own SSE emission — the runtime is transport-agnostic.

### D-34-03: `agent_invocations` Write Timing

**Decision:** INSERT at invocation START with `status='running'`, UPDATE at invocation END with final `status`, `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `error_detail`.

Rationale: AbortController-terminated and server-error calls leave a persistent `status='running'` row — Phase 40 observability can surface orphaned rows (duration_ms NULL, status='running', created_at > 10s ago).

The INSERT at start captures `trace_id`, `agent_id`, `channel`, `conversation_id`, `user_message`, `mode`, `depth`. The UPDATE at end fills `assistant_reply`, `tool_calls`, `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `status`, `error_detail`.

### D-34-04: Default Model for New Agents

**Decision:** `anthropic/claude-sonnet-4-6`

This matches the Main Agent seed from Phase 33. Applied at the application layer (default value in agent creation schema), not as a DB column default. Phase 36 (CRUD dashboard) will expose a model picker; Phase 34 runtime simply uses whatever `agents.model` is set on the row.

### D-34-05: `organizations.daily_cost_cap_usd_override` Column

**Decision:** Add via migration `042_org_daily_cost_cap.sql` in Phase 34.

Column: `daily_cost_cap_usd_override NUMERIC(8,2) NULL`

- `NULL` → use env-configured default (`AGENT_DAILY_COST_CAP_USD`, default `50.00`)
- Non-null → use this org's override value
- No RLS change needed (existing orgs RLS already covers the organizations table)
- No UI in Phase 34 — set via direct DB edit or future Phase 36 settings panel

### D-34-06: Runtime Prompt Resolution

**Decision:** Runtime reads prompt from `agent_prompt_versions` via `active_prompt_version_id`, NEVER from `agents.system_prompt` directly.

Join pattern:
```sql
SELECT apv.system_prompt
FROM agents a
JOIN agent_prompt_versions apv ON a.active_prompt_version_id = apv.id
WHERE a.id = $agentId AND a.organization_id = $orgId
```

Phase 33 seeded both the `agents.system_prompt` column and the `agent_prompt_versions` row + `active_prompt_version_id` pointer for every org. The DB trigger that auto-creates versions on `system_prompt` UPDATE is Phase 41 scope — in Phase 34, the runtime just reads the active version.

### D-34-07: Vapi Paths Unchanged

**Decision:** `resolveTool(orgId, toolName)` in `src/lib/action-engine/` keeps its exact current signature and is not modified. `resolveAgentTool(agentId, toolName)` is a NEW function in `src/lib/agent-runtime/resolve-agent-tool.ts`.

No file under `src/app/api/vapi/` is touched in Phase 34.

### D-34-08: GATE-03 Scope

GATE-03 reads: *"Load test (1000 req / 10 min from one IP) → rate-limited after 20/min, total cost < $5, kill switch flip → 503-graceful within 1s"*

Phase 34 builds the **kill switch** (`AGENT_RUNTIME_ENABLED=false` → structured 503 within 1s) and the **cost cap** (daily $ cap halts new invocations). The **20/min rate limit** is handled by Vercel's edge layer — no new rate-limiting middleware is built in Phase 34. The load test itself (1000 req/10 min) is an integration test run during Phase 34 verification to confirm the kill switch + cost cap hold under load.

### D-34-09: Phase 34 Does NOT Wire Into Live Channel Handlers

`runAgent` is built and tested in isolation in Phase 34. No live traffic calls it yet.

- Web widget (`src/app/api/chat/[token]/route.ts`) keeps calling `createChatStream` → Phase 35
- ManyChat (`src/lib/manychat/dispatch-event.ts`) keeps current behavior → Phase 37
- Meta (`src/lib/meta/process-event.ts`) keeps current behavior → Phase 37

### D-34-10: Delegation Depth Guard Is a Stub in Phase 34

Phase 34 wires the `MAX_DELEGATION_DEPTH` check (`ctx._depth >= MAX_DELEGATION_DEPTH`) and returns the synthetic message *"Delegation depth exceeded — answer from current agent"*. No actual partner invocation flows in Phase 34 (those come in Phase 38). The stub MUST be unit-tested by constructing a synthetic `ctx` with `_depth = 3` and asserting the guard fires correctly.

### D-34-11: `channel_overrides` Deep-Merge Logic

When `channel_overrides` JSONB contains a key for the invocation channel, the runtime deep-merges the override on top of the base agent fields before making the LLM call. Mergeable fields (per AGENT-07): `system_prompt` (suffix-append only — NOT replace), `model`, `temperature`, `max_tokens`, `max_history`. Any other key in the JSONB is silently ignored.

### D-34-12: `allowed_channels` Enforcement

If the invocation `channel` is NOT in `agents.allowed_channels`, `runAgent` returns early with:
```ts
{ status: 'denied', errorDetail: 'channel_not_allowed', text: agent.fallback_message }
```
No `agent_invocations` row is written for a denied channel call (it never started). The caller gets an AgentRunResult with `status='denied'` and surfaces the fallback message to the end user.

### D-34-13: Inactive Agent Enforcement

If `agents.is_active = false`, `runAgent` returns early with:
```ts
{ status: 'denied', errorDetail: 'agent_inactive', text: agent.fallback_message }
```
Consistent with D-34-12: no invocation row for a denied call.

### D-34-14: Tool Call Guard

When the LLM emits a tool call for a `toolName` not in the agent's attached set (i.e., `resolveAgentTool(agentId, toolName)` returns `null`):
- Runtime does NOT throw an exception
- Runtime does NOT invoke `executeAction`
- Runtime synthesizes a tool-result message back to the LLM: `"Tool not available to this agent"` with `denied_reason: 'tool_not_attached_to_agent'`
- This synthesized result is appended to the tool-call message array and the LLM continues the turn
- The denied tool call is logged in the `agent_invocations.tool_calls` JSONB with a `denied: true` flag

### D-34-15: Cost Computation

Cost per invocation = `(tokens_in / 1_000_000 * input_per_1m_usd) + (tokens_out / 1_000_000 * output_per_1m_usd)` joined from `agent_model_pricing` on `agents.model`. If no matching row exists in `agent_model_pricing`, `cost_usd` is set to `NULL` and a structured warning log is emitted (no failure).

Daily cost check queries `SUM(cost_usd) FROM agent_invocations WHERE organization_id = $orgId AND created_at >= (NOW() - INTERVAL '24 hours')`.

### D-34-16: Migration Numbering

Phase 34 adds one migration: `042_org_daily_cost_cap.sql` (adds `organizations.daily_cost_cap_usd_override`).

The previous migration on disk is `041_ghl_inbound.sql` (Phase 999.1 backlog). Migration 042 is the next available slot.

## File Structure (Phase 34 creates)

```
src/lib/agent-runtime/
  index.ts                  # exports runAgent()
  types.ts                  # AgentRunContext, AgentRunOptions, AgentRunResult
  resolve-agent.ts          # resolve agent row + apply channel_overrides
  resolve-agent-tool.ts     # resolveAgentTool(agentId, toolName) → ToolConfig | null
  guardrails.ts             # all cap checks: depth, llm-calls, tokens, cost, kill-switch
  invocations.ts            # insert-at-start, update-at-end helpers for agent_invocations
  run-agent.ts              # core orchestration loop (resolve → guard → llm → tool-dispatch → guard → write)

supabase/migrations/
  042_org_daily_cost_cap.sql  # ALTER organizations ADD daily_cost_cap_usd_override

tests/
  agent-runtime-smoke.test.ts          # unit: resolve, guardrails, invocation writes
  agent-runtime-guardrails.test.ts     # unit: each cap trips correctly
  agent-runtime-kill-switch.test.ts    # GATE-03 subset: AGENT_RUNTIME_ENABLED=false
```

## Existing Patterns to Reuse

| Pattern | Source |
|---|---|
| LLM provider abstraction (Anthropic + OpenRouter) | `src/lib/chat/stream/anthropic.ts`, `openrouter.ts` |
| `executeAction` tool dispatch | `src/lib/action-engine/execute-action.ts` |
| KB semantic search | `src/lib/knowledge/query-knowledge.ts` |
| Service-role Supabase client | `src/lib/supabase/server.ts` |
| RLS read pattern | Any dashboard page server component |

## Success Criteria (verbatim from ROADMAP)

1. `runAgent(ctx, opts)` resolves the agent, applies `channel_overrides` for the invocation channel, enforces `allowed_channels` (HTTP 422 on mismatch), and refuses inactive agents (HTTP 410)
2. All four cost/safety caps enforced from day 1: `MAX_DELEGATION_DEPTH=2` (placeholder hook for Phase 38), `MAX_LLM_CALLS_PER_TURN=6`, per-conversation token cap (default 200K), per-org daily $ cap (default $50, override via `organizations.daily_cost_cap_usd_override`); each emits a structured log event when tripped
3. Per-turn `AbortController` with 8s budget propagated to every LLM SDK call; on abort the partial reply is persisted with `status='aborted'`; `AGENT_RUNTIME_ENABLED=false` env flip causes every `runAgent` call to return a 503-graceful response within 1s (GATE-03)
4. Every `runAgent` call writes exactly one `agent_invocations` row with non-null `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `model`, `status`, `trace_id`; cost computed via join to `agent_model_pricing`
5. `resolveAgentTool(agentId, toolName)` exists alongside the unchanged `resolveTool(orgId, toolName)`; runtime tool-call guard refuses unattached tools with `denied_reason: 'tool_not_attached_to_agent'` and synthesizes a tool-result message back to the LLM
6. The `ai@^6` spike is run; the adoption decision is documented in the phase verifier output and respected by the codebase

## Deferred Ideas (NOT Phase 34)

- `agent_invocations` cleanup job for orphaned `status='running'` rows — Phase 40 or separate maintenance phase
- `agent_model_pricing` rate refresh automation — manual update until Phase 40 observability shows drift
- Per-agent rate limits per visitor — deferred to v2.x
- Token streaming relay from partner to end-user — deferred to v2.x
- `resolveAgentTool` caching (hot-path LRU cache) — defer until Phase 40 shows it's needed

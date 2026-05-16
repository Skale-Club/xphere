---
phase: 35
name: Web Widget Canary Cutover
milestone: v2.0
status: planning
discuss_completed: 2026-05-16
---

# Phase 35: Context + Locked Decisions

## Phase Boundary

Wire the web widget endpoint (`POST /api/chat/[token]`) to call `runAgent()` instead of `createChatStream()`. The widget SSE protocol is unchanged — same `session/token/tool_call/done` event shapes, same widget JS bundle, same Redis session logic for history window. The change is internal: the LLM call path switches from the legacy stream module to the new agent runtime.

**Phase 33 seeded a Main Agent per org** — every org already has a `web_widget` default in `agent_channel_defaults`. This is what makes byte-identical behavior possible.

**Phase 34 built `runAgent()`** — currently returns `Promise<AgentRunResult>` (non-streaming). Phase 35 adds the streaming overload that route.ts will use.

## Requirements in Scope

CHAN-03, GATE-01

## Out of Scope (Phase 35 boundary)

- ManyChat / Meta channel wiring → Phase 37
- Channel adapters (formatOutbound) → Phase 37
- Multi-agent delegation → Phase 38
- Agent CRUD UI → Phase 36
- Playground → Phase 39
- Removing the `createChatStream` shim (stays until Phase 38 complete)

---

## Locked Decisions

### D-35-01: `runAgent` Streaming Overload — SSE-ready ReadableStream

**Decision:** `runAgent({ ...opts, stream: true })` returns a `ReadableStream<Uint8Array>` (SSE-formatted, same wire format as today's `createChatStream`).

The runtime produces `{ event: 'session', sessionId }`, `{ event: 'token', text }`, `{ event: 'tool_call', ... }`, and `{ event: 'done' }` events. Route.ts just passes the stream to `new Response(stream, { headers: SSE_HEADERS })` — no SSE formatting in route.ts.

Implementation: use `streamText` from ai@^6 (instead of `generateText`) inside a new streaming code path in `run-agent.ts`. The `stream: boolean` flag on `AgentRunOptions` gates which path runs.

**Why ReadableStream over AsyncIterable:** Route.ts can return it directly. `createChatStream` shim becomes a one-line wrapper. No SSE loop in route.ts.

**Why not coupling concern:** The runtime's streaming path is only ever called from text-channel inbound handlers. SSE is the invariant for all of them (web widget in Phase 35, ManyChat/Meta will use `stream: false` in Phase 37). Acceptable coupling.

### D-35-02: `sessionId` Passed Into `runAgent` for `session` Event

**Decision:** `AgentRunOptions` gains an optional `sessionId?: string`. When streaming, the runtime emits `{ event: 'session', sessionId }` as the first event (required by GATE-01 — same as today). Route.ts passes the Redis `sessionId` in.

### D-35-03: Persistence Responsibility Split

**Decision:**

| Responsibility | Owner |
|---|---|
| User message → `conversation_messages` | Route.ts via `after()` (unchanged) |
| Redis session update (history window) | Route.ts (unchanged) |
| `agent_invocations` row | `runAgent` (unchanged from Phase 34) |
| Assistant message → `conversation_messages` | `runAgent` when `conversationId` is provided |
| Redis update with assistant message | Route.ts — reads the accumulated text from stream `done` event |

Concretely:
- Route.ts passes `conversationId: ctx.dbSessionId` to `runAgent`
- `runAgent` streaming path writes the assistant message to `conversation_messages` via `after()` when the stream closes (using service-role client)
- Route.ts intercepts the `done` event to extract accumulated text for Redis update — OR drops the Redis assistant message update entirely (Redis is cache only; history window is rebuilt from DB in future phases)
- `onReplyChunk` callback **removed** from `AgentRunOptions` and `createChatStream` params (it was only needed because route.ts owned accumulation)

**Why runAgent handles assistant persistence:** Route.ts becomes much simpler (no `let accumulatedReply`, no `onReplyChunk`). The runtime owns all LLM-related side effects.

**Redis simplification (Phase 35 scope):** The `ctx.messages.push({ role: 'assistant', content })` update in route.ts's `after()` is removed. Redis becomes a pure user-message history cache for the duration of Phase 35; history continues to work because the messages array is built from prior turns in Redis before calling `runAgent`. Phase 36+ will transition history window to come from DB.

### D-35-04: `createChatStream` Preserved as Shim

**Decision:** `src/lib/chat/stream.ts` is refactored but the exported `createChatStream` function signature is preserved so callers still compile. Internally it delegates to `runAgent({ stream: true, ... })` and returns the ReadableStream.

```ts
// After Phase 35 — createChatStream is a one-liner shim
export function createChatStream(params: CreateChatStreamParams): ReadableStream {
  return runAgent({ stream: true, ...mapParams(params) })
}
```

One-line revert: swap route.ts back to `createChatStream` call to roll back. This shim stays until Phase 38 completes.

### D-35-05: `conversations.agent_id` Migration (GATE-07 literal query)

**Decision:** Phase 35 adds migration `043_conversations_agent_id.sql`:

```sql
-- Additive
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) NULL;

-- Backfill: set Main Agent for all existing conversations
UPDATE conversations c
SET agent_id = (
  SELECT a.id FROM agents a
  WHERE a.organization_id = c.organization_id
    AND a.name = 'Main Agent'
  LIMIT 1
)
WHERE c.agent_id IS NULL;
```

After push, `SELECT count(*) FROM conversations WHERE agent_id IS NULL` returns 0 — this is the literal GATE-07 verification deferred from Phase 33 (D-33-20).

New widget conversations: when route.ts calls `runAgent`, it passes the `agentId` from `agent_channel_defaults` resolution. `runAgent` inserts the `agent_id` into the conversation row when creating `dbSessionId`.

### D-35-06: Agent Resolution in Route.ts

**Decision:** Route.ts does NOT resolve the agent — it just passes `orgId` and `channel: 'web_widget'` to `runAgent`. The runtime resolves the agent via `agent_channel_defaults` internally.

```ts
// New route.ts shape (after refactor)
const stream = await runAgent({
  orgId: org.id,
  channel: 'web_widget',
  conversationId: ctx.dbSessionId,
  sessionId,
  userMessage: message,
  historyWindow: ctx.messages,
  mode: 'production',
  stream: true,
})
```

The existing tool-fetching block in route.ts (lines 122-166) is **removed** — `runAgent` handles tool resolution via `resolveAgentTool` + `executeAction` internally.

### D-35-07: `export const maxDuration = 10`

**Decision:** Add `export const maxDuration = 10` to `src/app/api/chat/[token]/route.ts` (CHAN-03 explicit requirement). This declares the 10s Vercel function timeout explicitly.

### D-35-08: GATE-01 Snapshot Strategy

**Decision:** Test-driven with manually-defined expected event shapes (not a live recording).

The test (`tests/web-widget-canary.test.ts`) defines the expected SSE event sequence:
1. `{ event: 'session', sessionId: string }` — first event
2. One or more `{ event: 'token', text: string }` — LLM tokens
3. `{ event: 'done' }` — terminal event

The test hits the live widget endpoint with a known message and asserts:
- All three event types appear in order
- No `token` events appear before `session` or after `done`
- `sessionId` in the `session` event matches the one returned by `getSession`
- A `conversation_messages` row exists for the assistant reply
- `conversations.agent_id` is non-null for the session's conversation

"Zero observable differences" is validated by shape conformance (event types + ordering) rather than content diff, since the LLM response is non-deterministic.

### D-35-09: `streamText` vs `generateText` in run-agent.ts

**Decision:** The streaming path uses `streamText` from ai@^6 (new code path gated by `opts.stream`). The non-streaming path (`generateText`) is preserved and unchanged. No refactor of the existing Phase 34 non-streaming path.

```ts
if (opts.stream) {
  return runAgentStreaming(resolvedAgent, opts, invocationId, traceId)
}
return runAgentBlocking(resolvedAgent, opts, invocationId, traceId)
```

Both paths share: kill-switch check, resolveAgent, denied checks, INSERT invocation, guardrail checks, UPDATE invocation in finally.

### D-35-10: No New UI

Phase 35 ships **zero UI changes**. The existing widget JS bundle is unchanged. The chat-area realtime subscriptions (`postgres_changes` on `conversation_messages`) continue unchanged — `runAgent` writes to the same table with the same column names.

---

## Existing Code Patterns to Preserve

| Pattern | Location | Notes |
|---|---|---|
| SSE encoder | `src/lib/chat/stream/encoder.ts` | Reuse in runAgent streaming path |
| `after()` for async persist | `route.ts` + `run-agent.ts` | Both use `after()` — Next.js recommended pattern |
| `session/token/tool_call/done` SSE shapes | `stream/anthropic.ts`, `stream/openrouter.ts` | Canonical shapes — must match exactly |
| `export const runtime = 'nodejs'` | `route.ts` | Keep — agent runtime is Node.js only |
| CORS headers | `route.ts` | Keep — CORS required for embedded widget |

## Key Files

| File | Change |
|---|---|
| `src/app/api/chat/[token]/route.ts` | Replace `createChatStream` call with `runAgent({ stream: true, ... })`; add `maxDuration = 10`; remove tool-fetching block |
| `src/lib/agent-runtime/run-agent.ts` | Add streaming code path (streamText); split blocking vs streaming helpers |
| `src/lib/agent-runtime/types.ts` | Add `stream?: boolean; sessionId?: string; conversationId?: string` to `AgentRunOptions`; add streaming overload signature |
| `src/lib/agent-runtime/index.ts` | Re-export streaming overload |
| `src/lib/chat/stream.ts` | Refactor to `createChatStream` shim wrapping `runAgent({ stream: true })` |
| `supabase/migrations/043_conversations_agent_id.sql` | ADD COLUMN + backfill UPDATE + push |
| `src/types/database.ts` | Add `agent_id` to conversations table types |
| `tests/web-widget-canary.test.ts` | GATE-01 validation — SSE shape + persistence + agent_id assertions |

## Deferred Ideas

- Streaming relay from partner agent to end-user (token streaming through delegation chain) → v2.x
- History window sourced from DB instead of Redis → future phase (Phase 36 or later)
- `organizations.delegation_visibility` SSE events (`partner_start`, `partner_done`) → Phase 38

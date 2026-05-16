# Phase 35: Web Widget Canary Cutover - Research

**Researched:** 2026-05-16
**Domain:** ai@^6 streamText, Next.js after(), ReadableStream SSE, agent-runtime wiring
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

| Decision | What it means for planning |
|---|---|
| D-35-01 | `runAgent({ stream: true })` returns `ReadableStream<Uint8Array>` (SSE-formatted). Route.ts just passes it to `new Response(stream, { headers: SSE_HEADERS })`. |
| D-35-02 | `AgentRunOptions` gains `sessionId?: string`. Runtime emits `{ event: 'session', sessionId }` as first event. |
| D-35-03 | Persistence split: user message via route.ts `after()` (unchanged); assistant message via `runAgent` using `after()` when `conversationId` is provided; Redis assistant update REMOVED from route.ts. |
| D-35-04 | `createChatStream` preserved as a one-liner shim wrapping `runAgent({ stream: true })`. |
| D-35-05 | Migration `043_conversations_agent_id.sql`: ADD COLUMN + backfill. GATE-07 literal query post-push must return 0. |
| D-35-06 | Route.ts does NOT resolve the agent — passes `orgId + channel: 'web_widget'` to `runAgent`. Runtime resolves via `agent_channel_defaults`. |
| D-35-07 | `export const maxDuration = 10` added to route.ts. |
| D-35-08 | GATE-01 tested via manually-defined expected SSE shapes (not live recording). Test file: `tests/web-widget-canary.test.ts`. |
| D-35-09 | Streaming path uses `streamText` (new code path gated by `opts.stream`). Non-streaming `generateText` path is preserved and unchanged. |
| D-35-10 | Zero UI changes. Widget JS bundle unchanged. |

### Claude's Discretion

None listed — all implementation choices are locked by D-35-01 through D-35-10.

### Deferred Ideas (OUT OF SCOPE)

- Streaming relay from partner agent to end-user (token streaming through delegation chain) → v2.x
- History window sourced from DB instead of Redis → future phase (Phase 36 or later)
- `organizations.delegation_visibility` SSE events (`partner_start`, `partner_done`) → Phase 38
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAN-03 | `src/app/api/chat/[token]/route.ts` refactored to call `runAgent({stream: true})`; declares `export const maxDuration = 10`; existing `createChatStream` shim preserved | Route.ts dissection complete; streaming overload design documented below |
| GATE-01 | Snapshot diff of widget conversation post-migration shows zero observable differences: same SSE event shapes, same persisted messages, `conversations.agent_id` non-null | SSE shape inventory from anthropic.ts/openrouter.ts; persistence split fully mapped; migration 043 documented |
</phase_requirements>

---

## Summary

Phase 35 wires the web widget endpoint to call `runAgent({ stream: true })` instead of `createChatStream()`. The `runAgent` function currently returns `Promise<AgentRunResult>` (non-streaming, Phase 34). Phase 35 adds a **streaming overload** that wraps the same guardrail/resolution/LLM pipeline but uses `streamText` from ai@^6 instead of `generateText`, emitting SSE events via a `ReadableStream<Uint8Array>`.

The SSE wire format is already established by `stream/anthropic.ts` and `stream/openrouter.ts`: newline-delimited JSON objects with `{ event: 'session', sessionId }`, `{ event: 'token', text }`, `{ event: 'tool_call', name }`, and `{ event: 'done' }`. The encoder lives in `stream/encoder.ts` and can be reused without change.

Route.ts currently does two things that must be re-examined: (1) it fetches tool credentials itself (lines 123-166 — the entire tool-fetching block is removed per D-35-06, since `runAgent` already has `resolveAgentTool` internally), and (2) it accumulates the reply in `let accumulatedReply` via `onReplyChunk` so it can persist the assistant message. Per D-35-03 that accumulation responsibility moves into `runAgent`'s streaming path via `after()`, simplifying route.ts significantly.

**Primary recommendation:** Add `runAgentStreaming()` as a private function in `run-agent.ts`, gated by `opts.stream`. It shares the full guardrail/resolve/invocation-write pipeline with the blocking path, then diverges to `streamText` + a `new ReadableStream` builder that iterates `fullStream`, emits SSE events, and fires `after()` for assistant persistence and invocation end-update when the stream closes.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Confirmed |
|---------|---------|---------|-----------|
| `ai` | 6.0.184 | `streamText`, `fullStream`, `TextStreamPart` | `node_modules/ai/package.json` |
| `@ai-sdk/anthropic` | 3.0.78 | Anthropic provider for `streamText` (same as `generateText`) | Already in use in run-agent.ts |
| `next` | 16.2.2 | `after()` for post-stream side effects | Confirmed from package.json |
| `vitest` | existing | Test framework; `readSseLines` helper already in `tests/helpers/stream.ts` | vitest.config.ts |

### No new installs required

All libraries used in Phase 35 are already installed. Phase 35 is purely code changes + one SQL migration.

---

## Architecture Patterns

### Current route.ts Flow (what gets removed vs kept)

```
POST /api/chat/[token]
  1. await params                         → KEEP
  2. Parse + validate body                → KEEP
  3. Resolve org by widget_token          → KEEP
  4. Get or create session (Redis)        → KEEP
  5. Append user message to ctx + setSession → KEEP
  6. after(): persistMessage(user)        → KEEP unchanged
  7. Fetch tool_configs + integrations    → REMOVE (runAgent resolves internally)
  8. let accumulatedReply + after()       → REMOVE (runAgent owns assistant persist via D-35-03)
  9. createChatStream(...)                → REPLACE with runAgent({ stream: true, ... })
 10. return new Response(stream, SSE_HEADERS) → KEEP
```

The entire block from step 7 (lines 122-166 in current route.ts) and step 8 (lines 168-183) is removed. The new call site (per D-35-06) passes only:

```typescript
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

Note: `agentId` is NOT passed — `runAgent` resolves it from `agent_channel_defaults` internally (new logic needed in `runAgent`).

### Agent Resolution from `orgId + channel` (new lookup in runAgent)

Currently `runAgent` accepts `agentId: string` (required). For Phase 35, when route.ts passes `orgId + channel: 'web_widget'` without an `agentId`, `runAgent` must resolve the agent from `agent_channel_defaults`. This requires:

1. Making `agentId` optional in `AgentRunOptions`
2. Adding a resolution step at the top of `runAgent`: if `!agentId`, query `agent_channel_defaults` for `(orgId, channel)` to get `agentId`
3. If no default found, return a graceful error (same pattern as agent_not_found)

The `agent_channel_defaults` table already has all orgs seeded with `web_widget` → Main Agent (Phase 33 migration 040). The query uses the service-role client:

```typescript
const { data: defaultRow } = await supabase
  .from('agent_channel_defaults')
  .select('agent_id')
  .eq('organization_id', orgId)
  .eq('channel', channel)
  .single()

const resolvedAgentId = agentId ?? defaultRow?.agent_id
if (!resolvedAgentId) { return gracefulError('no_agent_for_channel') }
```

### SSE Event Shape Inventory (canonical, from anthropic.ts + openrouter.ts)

These are the exact shapes the new `runAgentStreaming()` must reproduce:

| Event | JSON shape | When emitted |
|-------|-----------|--------------|
| session | `{ event: 'session', sessionId: string }` | FIRST, always |
| token | `{ event: 'token', text: string }` | Each text delta from LLM |
| tool_call | `{ event: 'tool_call', name: string }` | When a tool is invoked |
| done | `{ event: 'done' }` | LAST, always |

Encoder: `createEncoder()` from `src/lib/chat/stream/encoder.ts` — returns a function `(obj: object) => Uint8Array`. Reuse directly in `runAgentStreaming`.

### streamText + fullStream Pattern (ai@^6, VERIFIED from type declarations)

`streamText` returns a `StreamTextResult` object synchronously. The result has:

- `textStream: AsyncIterableStream<string>` — text-only deltas
- `fullStream: AsyncIterableStream<TextStreamPart<TOOLS>>` — all events including tool invocations
- `usage: PromiseLike<LanguageModelUsage>` — token counts (available after stream consumed)
- `onFinish` callback option — fires after the full stream completes with `totalUsage`

`TextStreamPart` types relevant to Phase 35:
- `{ type: 'text-delta', text: string }` → emit `{ event: 'token', text }`
- `{ type: 'tool-input-start', toolName: string }` → emit `{ event: 'tool_call', name: toolName }`
- `{ type: 'finish', totalUsage: LanguageModelUsage }` → trigger persistence + invocation end-update
- `{ type: 'error', error: unknown }` → handle error path

**CRITICAL DIFFERENCE from generateText:** `streamText` parameters accept the same fields (`model`, `system`, `messages`, `tools`, `stopWhen`, `abortSignal`, `temperature`, `maxOutputTokens`) so the existing tool construction code from `runAgent` can be reused verbatim.

Token usage: access via `onFinish` callback (fires after stream) OR await `result.usage` after stream consumed. The `onFinish` approach is cleaner for streaming because it fires without requiring the caller to await — use `onFinish` to capture `event.totalUsage.inputTokens` and `event.totalUsage.outputTokens` for `updateInvocationEnd`.

### ReadableStream Builder Pattern

The streaming path returns a `new ReadableStream<Uint8Array>` whose `start(controller)` async function:

1. Calls all pre-LLM steps (kill switch, resolveAgent, guardrails, insertInvocationStart)
2. Calls `streamText(...)` — which returns synchronously
3. Iterates `result.fullStream` for events
4. For each `text-delta` event: `controller.enqueue(encode({ event: 'token', text }))`
5. For each `tool-input-start` event: `controller.enqueue(encode({ event: 'tool_call', name }))`
6. Calls `controller.enqueue(encode({ event: 'done' }))` after iteration
7. Calls `controller.close()`
8. Calls `after()` to persist assistant message + updateInvocationEnd

**Pattern for the streaming overload return type:**

```typescript
// In types.ts — add streaming overload signature
export type AgentRunOptions = {
  orgId: string
  agentId?: string           // NOW OPTIONAL — resolved from agent_channel_defaults when absent
  channel: AgentChannel
  userMessage: string
  conversationId?: string
  sessionId?: string         // NEW — passed through for session event
  historyWindow?: Array<{ role: 'user' | 'assistant'; content: string }>
  mode?: 'production' | 'playground'
  stream?: boolean           // NEW — gates streaming vs blocking path
  _depth?: number
  parentInvocationId?: string
}

// Function overload signatures in run-agent.ts
export function runAgent(opts: AgentRunOptions & { stream: true }): ReadableStream<Uint8Array>
export function runAgent(opts: AgentRunOptions & { stream?: false }): Promise<AgentRunResult>
export function runAgent(opts: AgentRunOptions): ReadableStream<Uint8Array> | Promise<AgentRunResult>
```

### Persistence in Streaming Path (D-35-03)

`after()` WORKS in `ReadableStream.start()` — Next.js 16 `after()` schedules work after the response is fully sent. It is safe to call from within a `ReadableStream` controller. The existing route.ts already calls `after()` from within an async function that runs before the stream returns.

Implementation inside `runAgentStreaming`:

```typescript
// After controller.close() — inside the finally block of the stream
after(async () => {
  try {
    // Persist assistant message to conversation_messages
    if (conversationId && accumulatedText) {
      await persistMessage({
        dbSessionId: conversationId,
        orgId,
        role: 'assistant',
        content: accumulatedText,
      })
    }
    // Update invocation row
    await updateInvocationEnd({
      invocationId,
      agentId: resolvedAgentId,
      model: resolvedAgent.model,
      status: finalStatus,
      assistantReply: accumulatedText,
      tokensIn,
      tokensOut,
      toolCallsJson: toolCallsLog,
      errorDetail,
      startedAt,
    })
  } catch (err) {
    console.error('[runAgent/stream] post-stream persist failed:', err)
  }
})
```

`persistMessage` is already in `src/lib/chat/persist.ts` and handles both the `conversation_messages` INSERT and the `conversations` UPDATE (last_message, last_message_at). No new persistence function needed.

### conversations.agent_id Migration (043)

Current `conversations` table in `database.ts` has NO `agent_id` column. Migration 043 adds it:

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) NULL;

UPDATE conversations c
SET agent_id = (
  SELECT a.id FROM agents a
  WHERE a.organization_id = c.org_id
    AND a.name = 'Main Agent'
  LIMIT 1
)
WHERE c.agent_id IS NULL;
```

**Note:** The column in `conversations` is `org_id` (not `organization_id`) — confirmed from `database.ts` line 1060. The migration backfill must join on `c.org_id = a.organization_id` (matching the agents table column name).

After push: `SELECT count(*) FROM conversations WHERE agent_id IS NULL` must return 0.

After migration, `ensureDbSession` in `persist.ts` must insert `agent_id` when creating the conversation row. Route.ts will need to pass `agentId` to `ensureDbSession` OR `runAgent` inserts the agent_id — per D-35-03 design, route.ts stays simple, so `runAgent` should update the conversation row with `agent_id` after resolving it, or the conversation should be created with `agent_id` from the start.

**Resolution:** `ensureDbSession` currently doesn't accept `agent_id`. Two options:
1. Add `agent_id` param to `ensureDbSession` — requires route.ts to resolve agent first (contradicts D-35-06)
2. Have `runAgent` UPDATE the conversations row with `agent_id` after resolving the agent — cleaner, route.ts stays simple

Option 2 is preferred per D-35-06. `runAgent` calls `supabase.from('conversations').update({ agent_id: resolvedAgentId }).eq('id', conversationId)` early in the streaming path (after resolveAgent).

### createChatStream Shim (D-35-04)

After Phase 35, `stream.ts` becomes:

```typescript
export function createChatStream(params: CreateChatStreamParams): ReadableStream {
  return runAgent({
    stream: true,
    orgId: params.orgId,
    sessionId: params.sessionId,
    channel: 'web_widget',
    userMessage: params.message,
    conversationId: params.ctx.dbSessionId,
    historyWindow: params.ctx.messages,
    mode: 'production',
  })
}
```

The `onReplyChunk` callback is removed from `CreateChatStreamParams` (it was only used for accumulation which now happens inside `runAgent`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token streaming | Custom Anthropic SDK streaming loop | `streamText` from `ai@^6` + `fullStream` iterator | Already adopted in Phase 34; fullStream provides tool-call events too |
| SSE encoding | Custom encoding | `createEncoder()` from `src/lib/chat/stream/encoder.ts` | Already encodes `JSON + \n` as Uint8Array |
| Post-stream work | `setTimeout` or raw promise chaining | `after()` from `next/server` | Official Next.js pattern; already used in route.ts and run-agent.ts |
| Agent DB persistence | Custom service-role fetch | `persistMessage()` from `src/lib/chat/persist.ts` | Handles conversation_messages + conversations.last_message atomically |
| Assistant message accumulation | Concatenating inside SSE handler | Capture in `onFinish` callback or accumulate in `fullStream` loop before `done` | Cleaner; avoids closure issues |

---

## Common Pitfalls

### Pitfall 1: `agentId` Required in Current `AgentRunOptions`

**What goes wrong:** Current `run-agent.ts` line 89 calls `resolveAgent(agentId, orgId, channel)` where `agentId` is required. Route.ts per D-35-06 does NOT pass `agentId`. If types are not updated, TypeScript will error.

**How to avoid:** Make `agentId?: string` optional in `AgentRunOptions`. Add a resolution step at the top of `runAgent` that fetches from `agent_channel_defaults` when `agentId` is absent. This lookup happens BEFORE `insertInvocationStart` (which needs the agentId).

### Pitfall 2: `after()` Must Be Called from Route Handler Scope, Not Stream Scope

**What goes wrong:** `after()` registered inside `ReadableStream.start()` may or may not be associated with the correct request context in some Next.js versions. The existing pattern in route.ts registers `after()` BEFORE returning the stream — the `after()` call at the route level is safe.

**How to avoid:** For streaming assistant persistence, call `after()` from within the `ReadableStream.start()` function AFTER `controller.close()`. This is the standard pattern (confirmed by existing route.ts behavior — it calls `after()` inside `async POST()` which is the route handler scope). The stream `start()` function is an async callback called within the route handler's promise chain, so `after()` calls inside it remain in the request context.

**Verified:** Current route.ts has `after(async () => { ... })` at lines 111-117 and 172-183 — both inside the `POST` function body, before `return`. The new pattern in `runAgentStreaming` calls `after()` inside the `start()` callback which executes synchronously during stream construction before the response is returned.

### Pitfall 3: `streamText` Returns Synchronously (no `await`)

**What goes wrong:** Unlike `generateText`, `streamText` is NOT async — it returns a `StreamTextResult` immediately. Calling `await streamText(...)` would await the result object, not the stream completion. The stream is consumed by iterating `result.fullStream`.

**How to avoid:**
```typescript
// CORRECT
const result = streamText({ model: ..., messages: ..., ... })
for await (const part of result.fullStream) { ... }

// WRONG — awaiting the return value
const result = await streamText(...)  // TypeScript will catch this
```

### Pitfall 4: Tool Execution Happens Inside `dynamicTool.execute` During fullStream Iteration

**What goes wrong:** When `streamText` calls a tool, it executes the tool's `execute` function and waits for the result before continuing the stream. This means the fullStream iteration pauses during tool execution. The tool execution in the streaming path works identically to the blocking path — the same `resolveAgentTool` + `executeAction` pattern.

**How to avoid:** Reuse the exact `toolSet` construction from `runAgentBlocking` (the existing `runAgent` body). The tool `execute` functions close over `agentId`, `orgId`, `traceId`, `channel`, `toolCallsLog`, `serviceClient` — all available in `runAgentStreaming` scope.

### Pitfall 5: Conversations Table Uses `org_id` Not `organization_id`

**What goes wrong:** The `conversations` table uses `org_id` (not `organization_id` like most other tables). The migration 043 backfill must join on the correct column name.

**How to avoid:** Migration backfill:
```sql
UPDATE conversations c
SET agent_id = (
  SELECT a.id FROM agents a
  WHERE a.organization_id = c.org_id    -- c.org_id, not c.organization_id
    AND a.name = 'Main Agent'
  LIMIT 1
)
WHERE c.agent_id IS NULL;
```

### Pitfall 6: `database.ts` Must Be Updated After Migration 043

**What goes wrong:** `src/types/database.ts` is manually maintained. After `npx supabase db push` for migration 043, the `conversations.Row` type still has no `agent_id` column until `database.ts` is updated. Type errors will appear in any code that references `conversations.agent_id`.

**How to avoid:** After pushing migration 043, update `database.ts` manually:
- `conversations.Row` → add `agent_id: string | null`
- `conversations.Insert` → add `agent_id?: string | null`
- `conversations.Update` → add `agent_id?: string | null`

### Pitfall 7: Existing `chat-api.test.ts` Tests Still Import `createChatStream` Path

**What goes wrong:** After Phase 35, route.ts no longer calls `createChatStream` directly — it calls `runAgent`. The existing `chat-api.test.ts` mocks `@/lib/integrations/get-provider-key`, `@anthropic-ai/sdk`, and `openai` — all of which are now called from within `runAgent`, not from route.ts or `createChatStream`. The mock targets must shift.

**How to avoid:** After the cutover, `chat-api.test.ts` must be updated to mock `@/lib/agent-runtime` or its internal dependencies (the `ai` SDK's `streamText`, `@ai-sdk/anthropic`, `resolveAgent`, `insertInvocationStart`, etc.). The new test for GATE-01 (`web-widget-canary.test.ts`) can be integration-focused against a real Supabase (same pattern as `agent-runtime-integration.test.ts`).

---

## Code Examples

### streamText + fullStream Iteration (verified from ai@^6 type declarations)

```typescript
// Source: node_modules/ai/dist/index.d.ts — StreamTextResult.fullStream
import { streamText, dynamicTool, jsonSchema, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

const result = streamText({
  model: anthropic(resolvedAgent.model),
  system: systemPrompt,
  messages,
  tools: Object.keys(toolSet).length > 0 ? toolSet : undefined,
  stopWhen: stepCountIs(MAX_LLM_CALLS_PER_TURN),
  abortSignal: controller.signal,
  ...(resolvedAgent.temperature !== undefined ? { temperature: resolvedAgent.temperature } : {}),
  maxOutputTokens: resolvedAgent.maxTokens,
  onFinish: (event) => {
    tokensIn = event.totalUsage.inputTokens ?? 0
    tokensOut = event.totalUsage.outputTokens ?? 0
  },
})

let accumulatedText = ''

for await (const part of result.fullStream) {
  if (part.type === 'text-delta') {
    emit({ event: 'token', text: part.text })
    accumulatedText += part.text
  } else if (part.type === 'tool-input-start') {
    emit({ event: 'tool_call', name: part.toolName })
  } else if (part.type === 'error') {
    // handle error
  }
}
```

### ReadableStream Builder Structure

```typescript
// Pattern for runAgentStreaming return value
function runAgentStreaming(
  resolvedAgent: ResolvedAgent,
  opts: AgentRunOptions & { stream: true },
  invocationId: string,
  traceId: string,
  startedAt: number,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encode = createEncoder()
      const emit = (obj: object) => controller.enqueue(encode(obj))

      // Emit session event first (GATE-01)
      emit({ event: 'session', sessionId: opts.sessionId })

      let accumulatedText = ''
      let finalStatus: 'success' | 'error' | 'aborted' | 'skipped' = 'success'
      let tokensIn = 0
      let tokensOut = 0

      try {
        // ... build toolSet (same as blocking path) ...

        const result = streamText({ ... , onFinish: (e) => {
          tokensIn = e.totalUsage.inputTokens ?? 0
          tokensOut = e.totalUsage.outputTokens ?? 0
        }})

        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            emit({ event: 'token', text: part.text })
            accumulatedText += part.text
          } else if (part.type === 'tool-input-start') {
            emit({ event: 'tool_call', name: part.toolName })
          } else if (part.type === 'error') {
            finalStatus = 'error'
            // ...
          }
        }

        emit({ event: 'done' })
      } catch (err) {
        // Error handling same as blocking path
        emit({ event: 'token', text: resolvedAgent.fallbackMessage })
        emit({ event: 'done' })
        finalStatus = 'error'
      } finally {
        controller.close()
        clearTimeout(timeoutId)

        after(async () => {
          try {
            if (opts.conversationId && accumulatedText) {
              await persistMessage({
                dbSessionId: opts.conversationId,
                orgId: opts.orgId,
                role: 'assistant',
                content: accumulatedText,
              })
            }
            await updateInvocationEnd({ ... })
          } catch (err) {
            console.error('[runAgent/stream] post-stream persist failed:', err)
          }
        })
      }
    },
  })
}
```

### Migration 043 (conversations.agent_id)

```sql
-- 043_conversations_agent_id.sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) NULL;

UPDATE conversations c
SET agent_id = (
  SELECT a.id FROM agents a
  WHERE a.organization_id = c.org_id
    AND a.name = 'Main Agent'
  LIMIT 1
)
WHERE c.agent_id IS NULL;
```

### createChatStream Shim

```typescript
// stream.ts after Phase 35 refactor
export function createChatStream(params: CreateChatStreamParams): ReadableStream {
  return runAgent({
    stream: true,
    orgId: params.orgId,
    sessionId: params.sessionId,
    channel: 'web_widget',
    userMessage: params.message,
    conversationId: params.ctx.dbSessionId,
    historyWindow: params.ctx.messages,
    mode: 'production',
  })
}
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (existing) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/web-widget-canary.test.ts` |
| Full suite command | `npx vitest run` |
| Test timeout | 30000ms (vitest.config.ts) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAN-03 | route.ts calls `runAgent({stream:true})`, declares `maxDuration=10`, shim compiles | unit/build | `npm run build` (type check) | N/A — verified by build |
| GATE-01 SSE shape | `session` first, `token` events, `done` last | integration | `npx vitest run tests/web-widget-canary.test.ts` | ❌ Wave 0 |
| GATE-01 persistence | `conversation_messages` row exists for assistant reply | integration | `npx vitest run tests/web-widget-canary.test.ts` | ❌ Wave 0 |
| GATE-01 agent_id | `conversations.agent_id` non-null for session's row | integration | `npx vitest run tests/web-widget-canary.test.ts` | ❌ Wave 0 |
| D-35-05 backfill | `SELECT count(*) FROM conversations WHERE agent_id IS NULL` = 0 | manual/SQL | `npx supabase db push` then psql query | N/A — verified by push |

### Sampling Rate

- **Per task commit:** `npm run build` (type check gate)
- **Per wave merge:** `npx vitest run tests/web-widget-canary.test.ts`
- **Phase gate:** Full suite `npx vitest run` green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/web-widget-canary.test.ts` — GATE-01 integration test (SSE shape + persistence + agent_id assertions)
  - Pattern: same as `tests/agent-runtime-integration.test.ts` (real Supabase, `beforeAll` finds Main Agent, fires real widget POST)
  - Mocking note: `after()` must be mocked as `vi.fn((fn) => fn())` same as in `chat-api.test.ts`
  - Alternative: mock `runAgent` at the route level and verify SSE shape in isolation (unit approach)

---

## File Change Map

| File | Change | Complexity |
|------|--------|------------|
| `src/lib/agent-runtime/types.ts` | `agentId?: string` (optional); add `stream?: boolean; sessionId?: string` to `AgentRunOptions`; add function overload signatures | Low |
| `src/lib/agent-runtime/run-agent.ts` | Add agent-channel-defaults resolution; split into `runAgentBlocking` + `runAgentStreaming`; gate on `opts.stream` | High (core change) |
| `src/lib/agent-runtime/index.ts` | Re-export streaming overload signature | Trivial |
| `src/lib/chat/stream.ts` | Refactor to shim: remove all internal logic, wrap `runAgent({ stream: true, ... })` | Medium (delete lots of code) |
| `src/app/api/chat/[token]/route.ts` | Remove tool-fetching block (lines 122-166); remove accumulation after() (lines 168-183); replace `createChatStream` call with `runAgent`; add `maxDuration = 10` | Medium |
| `supabase/migrations/043_conversations_agent_id.sql` | ADD COLUMN + backfill | Low |
| `src/types/database.ts` | Add `agent_id` to conversations Row/Insert/Update | Low |
| `tests/web-widget-canary.test.ts` | New GATE-01 test file | Medium |

---

## Open Questions

1. **`after()` inside `ReadableStream.start()` in Next.js 16**
   - What we know: `after()` is documented for use inside route handlers. Route.ts already uses it in the POST function body. The `ReadableStream.start()` callback runs synchronously before the response is returned, so the `after()` call happens within the request lifecycle.
   - What's unclear: Whether `after()` called deep inside a nested async callback (stream `start()` → try/finally → `after()`) is guaranteed to fire after stream consumption in all cases.
   - Recommendation: Mirror the existing pattern — call `after()` in the `finally` block inside `start()`, same as route.ts calls it before `return`. This is the safe, established pattern for this codebase.

2. **Existing `chat-api.test.ts` compatibility after route.ts refactor**
   - What we know: `chat-api.test.ts` mocks `@anthropic-ai/sdk` and `openai` directly. After route.ts switches to `runAgent`, these mocks no longer intercept the LLM calls (they happen inside `runAgent` → `streamText` → `@ai-sdk/anthropic`).
   - Recommendation: The plan should include a task to update `chat-api.test.ts` to either (a) mock `@/lib/agent-runtime` at the module level, or (b) mock `ai` and `@ai-sdk/anthropic` at the SDK level. The existing mock pattern for `next/server.after` remains unchanged.

3. **KB injection in streaming path**
   - What we know: The current `runAgent` blocking path only calls `queryKnowledge` when `resolvedAgent.kbScope !== null`. The Main Agent seeded in Phase 33 has `kbScope = null` (full org KB).
   - What's unclear: Should the streaming path also inject KB context for `kbScope === null` (full org KB), matching what `stream.ts` currently does (always queries KB)?
   - Recommendation: For GATE-01 byte-identical behavior, the streaming path should query KB for ALL agents (both null and non-null kbScope), matching `stream.ts` behavior. Add KB query before LLM call in `runAgentStreaming` regardless of kbScope.

---

## Environment Availability

Step 2.6: SKIPPED (no new external dependencies — all libraries already installed, Supabase already running).

---

## Sources

### Primary (HIGH confidence — direct file inspection)

- `src/lib/chat/stream/anthropic.ts` — SSE event shapes confirmed
- `src/lib/chat/stream/openrouter.ts` — SSE event shapes confirmed
- `src/lib/chat/stream/encoder.ts` — encoder implementation
- `src/app/api/chat/[token]/route.ts` — current route structure, what to remove
- `src/lib/agent-runtime/run-agent.ts` — Phase 34 implementation, shared pipeline
- `src/lib/agent-runtime/types.ts` — current types, what to extend
- `src/lib/agent-runtime/invocations.ts` — persistence helpers
- `src/lib/chat/persist.ts` — `persistMessage` signature confirmed
- `src/types/database.ts` — conversations table confirmed (no agent_id)
- `node_modules/ai/dist/index.d.ts` — `StreamTextResult`, `TextStreamPart`, `OnFinishEvent`, `LanguageModelUsage` types all verified

### Secondary (HIGH confidence — package inspection)

- `node_modules/ai/package.json` — version 6.0.184 confirmed
- `node_modules/next/package.json` — version 16.2.2 confirmed
- `supabase/migrations/036_agent_channel_defaults.sql` — table structure confirmed
- `supabase/migrations/040_seed_main_agents.sql` — Phase 33 seed confirmed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and in use
- streamText API: HIGH — verified directly from type declarations in node_modules
- SSE event shapes: HIGH — read directly from anthropic.ts and openrouter.ts
- Persistence split: HIGH — verified against persist.ts, session.ts, invocations.ts
- Architecture patterns: HIGH — based on existing codebase code, not guesswork
- Migration 043: HIGH — conversations table structure confirmed from database.ts
- `after()` inside stream: MEDIUM — documented pattern but nested call context not explicitly tested

**Research date:** 2026-05-16
**Valid until:** 2026-06-16 (stable stack, no moving targets)

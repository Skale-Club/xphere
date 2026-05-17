# Phase 39: Agent Playground — Research

**Date:** 2026-05-17
**Status:** RESEARCH COMPLETE

## 1. Existing Code Patterns

### Agent Runtime
- `src/lib/agent-runtime/run-agent.ts` — `runAgent()` accepts `mode?: 'production' | 'playground'` in `AgentRunOptions` (already typed)
- `src/lib/agent-runtime/types.ts` — `AgentRunContext.mode` is `'production' | 'playground'` already defined
- `src/lib/agent-runtime/invocations.ts` — `insertInvocationStart()` already writes `mode` to `agent_invocations` table
- `src/types/database.ts` — `AgentInvocationMode = 'production' | 'playground'` enum already in schema; `agent_invocations.mode` column exists
- The `mode='playground'` path is already wired through the full runtime stack — **no new migrations needed**

### Chat API Route Pattern
- `src/app/api/chat/[token]/route.ts` — public widget endpoint; uses Redis for session management, persists to `conversations` + `conversation_messages` via `persistMessage()` and `ensureDbSession()`
- The playground **must NOT** call this route; it needs its own API route that skips all persistence calls

### Streaming Pattern (D-35-09)
- `runAgent({ stream: true, mode: 'playground', ... })` returns `ReadableStream<Uint8Array>` with SSE events: `session`, `token`, `tool_call`, `partner_start`, `partner_done`, `done`
- `runAgentStreaming()` only persists via `after()` when `conversationId` is truthy — if we omit `conversationId`, no `conversation_messages` row is written
- Invocation row is still inserted via `insertInvocationStart()` regardless — this is intentional (PLAY-04: tag with mode='playground')

### Chat-Area Components (v1.4)
- `src/components/chat/chat-area/message-list.tsx` — renders `ConversationMessage[]` with visitor/assistant bubbles + internal/debug messages for tool calls
- `ConversationMessage` is in `src/types/chat.ts` — needs to be checked
- Existing `playground-chat.tsx` in `src/components/chat/playground-chat.tsx` uses the widget token path — we need a new agent-direct playground component

### Observability Widgets
- `src/lib/agent-runtime/guardrails.ts:202` — `checkDailyCostCap()` sums `cost_usd` from `agent_invocations` **without filtering by mode** — need to add `.neq('mode', 'playground')` filter
- Dashboard metrics in `src/app/(dashboard)/calls/actions.ts` — currently queries `calls` table not `agent_invocations`, so no filter needed there
- No other cost/latency widgets found querying `agent_invocations` directly

### Agent Page Routing
- Current: `src/app/(dashboard)/agents/[id]/page.tsx` — edit form
- Current: `src/app/(dashboard)/agents/[id]/prompt-history/` — sub-route pattern
- New route: `src/app/(dashboard)/agents/[id]/playground/page.tsx` — follows same pattern
- Layout: needs "Playground" button on the agent edit page header (like "Prompt History" button)

### Channel Model
- `AgentChannel` enum values: `web_widget | whatsapp | messenger | instagram | manychat | telegram`
- Source: `src/lib/agent-runtime/types.ts` + database schema
- Playground channel selector must cover all 6 values; default = `web_widget`
- Channel overrides are applied in `resolveAgent()` — just pass the selected channel to `runAgent()`

## 2. Implementation Plan

### New Files Required
1. `src/app/api/playground/[agentId]/route.ts` — authenticated playground API endpoint (session-auth user, no Redis, no conversation persistence, passes `mode='playground'` to `runAgent`)
2. `src/app/(dashboard)/agents/[id]/playground/page.tsx` — server component that fetches agent and renders playground
3. `src/components/agents/agent-playground.tsx` — client component with channel selector, message list, session management

### Modified Files
4. `src/app/(dashboard)/agents/[id]/page.tsx` — add "Playground" button to header
5. `src/lib/agent-runtime/guardrails.ts` — filter `mode != 'playground'` in `checkDailyCostCap()`

### SSE Events to Handle in Playground UI
- `session` → store session ID (for new session tracking)
- `token` → append to assistant message
- `tool_call` → show tool call badge inline with name
- `tool_result` → show result inline (note: currently `run-agent.ts` emits `tool_call` but NOT `tool_result` in SSE — need to check if we add that or just show call)
- `partner_start` / `partner_done` → delegation badges

### tool_call SSE Events (Current State)
Looking at `runAgentStreaming()` in `run-agent.ts`:
```
} else if (part.type === 'tool-input-start') {
  emit({ event: 'tool_call', name: part.toolName })
}
```
There's no `tool_result` event emitted. We need to also emit `tool_result` events in the streaming path for playground use. OR we can use a different approach: the playground API can use the blocking path (`stream: false`) and extract tool calls from the `AgentRunResult` to show inline. **Recommendation: use streaming for live display but add `tool_result` emission to the streaming path.**

Actually, re-reading the requirements: "tool calls display arguments + result + timing inline" — timing is in `agent_invocations.duration_ms` which we won't have during streaming. Better to:
1. Stream tokens normally
2. After done, fetch the invocation row to get tool_calls JSON with args + result + timing

OR simpler: the playground UI maintains a local state of tool calls collected from SSE events, and we extend the SSE protocol with `tool_result` events.

**Decision: extend `runAgentStreaming` to emit `tool_result` events when a tool call completes.** We can do this by wrapping the tool execution to emit before returning. This is cleanest and reuses the streaming path.

Actually — looking at the Vercel AI SDK `streamText` API — the `fullStream` loop catches `tool-input-start` but not the result. The tool `execute` function has access to the `emit` closure. We can emit `tool_result` from within the tool execute closure.

**But** we can't easily add this to the main `run-agent.ts` without affecting all callers. Instead: the playground API route uses `runAgent({ stream: true, mode: 'playground' })` and the playground client handles `tool_call` events with just the name (no args/result during streaming). Then optionally after streaming is complete, it can fetch the invocation's `tool_calls` JSON from the API for detailed display.

**Final Decision:** Two-phase approach:
1. During streaming: show `tool_call` badge with name (live)
2. After `done` event: fetch invocation details via a separate endpoint to get args + result + timing, update the inline display

This avoids changing `run-agent.ts` for this phase and keeps the implementation clean.

## 3. Validation Architecture

### PLAY-01 Verification
- `src/app/(dashboard)/agents/[id]/playground/page.tsx` exists
- Network tab shows SSE stream from `/api/playground/[agentId]`
- `agent_invocations` row created with `mode='playground'`

### PLAY-02 Verification
- Channel selector renders 6 options
- Changing channel and sending message → new invocation row has different `channel` value

### PLAY-03 Verification
- "New session" button clears messages array and resets sessionId state
- Agent and channel selection preserved after reset

### PLAY-04 Verification
- `agent_invocations` row has `mode='playground'`
- Cost/latency dashboard widgets exclude playground rows (guardrails.ts filter)

### PLAY-05 Verification
- Before/after row count in `conversations` and `conversation_messages` — no new rows after playground run
- Verified by: snapshot `SELECT COUNT(*) FROM conversations` before and after sending playground message

## 4. Key Risk: streaming path and `conversationId`
In `runAgentStreaming()`, the `after()` block writes `conversation_messages` only if `conversationId` is truthy:
```ts
if (conversationId && accumulatedText) {
  await persistMessage({ dbSessionId: conversationId, ... })
}
```
The playground API route must NOT pass `conversationId` — this is the mechanism for PLAY-05 compliance. Verified by reading `run-agent.ts` lines 1148-1149.

## RESEARCH COMPLETE

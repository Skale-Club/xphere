---
status: passed
phase: 39-agent-playground
verified: 2026-05-17
---

# Phase 39: Agent Playground — Verification

## Phase Goal
Each agent has a test playground at `/dashboard/agents/[id]/playground` where an admin chats against the agent across channel modes; tool calls and partner invocations render inline; playground sessions carry `mode='playground'` so they're excluded from production observability counts and don't write to `conversations`/`conversation_messages`.

## Must-Haves Verification

### PLAY-01: Streamed chat with tool call display
- [x] `/dashboard/agents/[id]/playground` page exists at `src/app/(dashboard)/agents/[id]/playground/page.tsx`
- [x] `AgentPlayground` client component renders streamed SSE responses via `/api/playground/[agentId]`
- [x] Tool call events render inline with `role: 'tool_call'` messages (Wrench icon + args/result after invocation fetch)
- [x] `runAgent({ stream: true, mode: 'playground' })` used for streaming

### PLAY-02: Channel selector
- [x] `src/components/agents/agent-playground.tsx` has Select component with all 6 channel values: `web_widget`, `whatsapp`, `messenger`, `instagram`, `manychat`, `telegram`
- [x] Channel is passed in the POST body to `/api/playground/[agentId]` on every send
- [x] Switching channel mid-session is allowed (no session reset required on channel change)

### PLAY-03: New session button
- [x] "New session" button calls `resetSession()` which clears: `messages`, `sessionId`, `historyWindow`
- [x] Agent (`agentId`, `agentName`) and `channel` are NOT cleared — preserved across session reset

### PLAY-04: mode='playground' tagging + observability exclusion
- [x] `/api/playground/[agentId]/route.ts` passes `mode: 'playground'` to `runAgent()`
- [x] `agent_invocations` rows tagged with `mode='playground'` (written by `insertInvocationStart`)
- [x] `checkDailyCostCap()` in `guardrails.ts` filters `.eq('mode', 'production')` — playground rows excluded from cost cap computation
- [x] Invocation detail endpoint at `/api/playground/[agentId]/invocation/[invocationId]` filters by `mode='playground'`

### PLAY-05: No conversations/conversation_messages writes
- [x] `/api/playground/[agentId]/route.ts` does NOT pass `conversationId` to `runAgent()`
- [x] `runAgentStreaming()` only persists `conversation_messages` when `conversationId` is truthy (verified in `run-agent.ts` line 1148-1149)
- [x] `ensureDbSession()` is NOT called from the playground API route (only widget route uses it)
- [x] No `persistMessage()` calls from the playground route

## Build Verification

```
✓ Compiled successfully
✓ TypeScript: no errors
✓ Routes registered:
  ƒ /agents/[id]/playground
  ƒ /api/playground/[agentId]
  ƒ /api/playground/[agentId]/invocation/[invocationId]
```

## Requirements Coverage

| REQ-ID | Plan | Status |
|--------|------|--------|
| PLAY-01 | 39-01, 39-02, 39-03 | ✓ |
| PLAY-02 | 39-02, 39-03 | ✓ |
| PLAY-03 | 39-02 | ✓ |
| PLAY-04 | 39-01, 39-03 | ✓ |
| PLAY-05 | 39-01 | ✓ |

## Human Verification Items

The following require manual testing in a running browser session:

1. Open `/dashboard/agents/[id]/playground`, send a message, verify SSE stream appears with streamed tokens
2. Switch channel selector from `web_widget` to `whatsapp` mid-conversation, send again — verify new invocation has correct channel
3. Click "New session" — verify messages clear but channel selection persists
4. Check Supabase `conversations` table row count before and after playground run — count must be unchanged
5. Check Supabase `agent_invocations` — row should have `mode='playground'`

---
phase: 03-ai-conversation-engine
verified: 2026-04-04T12:00:00Z
status: passed
score: 8/8 must-haves verified
re_verification: false
---

# Phase 3: AI Conversation Engine Verification Report

**Phase Goal:** The chat API returns streamed AI responses that draw from the org's knowledge base and can invoke the action engine during conversation
**Verified:** 2026-04-04
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from 03-02-PLAN.md must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A POST to /api/chat/[token] with a valid token returns Content-Type: text/event-stream | VERIFIED | `route.ts:183` sets `Content-Type: text/event-stream`; test CHAT-01 asserts and passes |
| 2 | The first SSE line is `{"event":"session","sessionId":"<uuid>"}` before any tokens | VERIFIED | `stream.ts:190` emits `{ event: 'session', sessionId }` as first controller.enqueue; confirmed by 4 passing tests |
| 3 | Subsequent lines are `{"event":"token","text":"<chunk>"}` events streamed incrementally | VERIFIED | `stream.ts:313–314` (OpenRouter) and `stream.ts:419–420` (Anthropic) emit token events; CHAT-01 test asserts tokenEvents.length > 0 |
| 4 | The final line is `{"event":"done"}` | VERIFIED | `stream.ts:251` emits done before close; test CHAT-01 asserts `lines[lines.length - 1]` matches `{ event: 'done' }` |
| 5 | queryKnowledge is called for every message and its result is injected into the system prompt before the LLM call | VERIFIED | `stream.ts:208` calls `queryKnowledge(message, orgId, supabase)` unconditionally (when org has a provider key); result injected into systemPrompt at line 216; CHAT-02 test confirms call with correct args |
| 6 | When the model returns a tool_use stop, executeAction is called and `{"event":"tool_call","name":"<action_type>"}` is emitted mid-stream | VERIFIED | OpenRouter path: `stream.ts:326–343`; Anthropic path: `stream.ts:415–439`; CHAT-03 test asserts both tool_call event and executeAction called |
| 7 | When the org has no API keys, the stream emits a single token with 'This assistant is not yet configured. Please contact the site owner.' then done — no HTTP error | VERIFIED | `stream.ts:196–202`; D-12 test asserts status 200, token containing 'not yet configured', and done event |
| 8 | The assistant reply is stored in Redis (setSession) and Supabase (persistMessage) after the stream ends via after() | VERIFIED | `route.ts:157–167` registers `after()` in route scope before return; accumulates reply via `onReplyChunk` closure; calls both `setSession` and `persistMessage` for assistant role |

**Score:** 8/8 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/chat/stream.ts` | Shared ReadableStream builder and SSE encoder used by the route | VERIFIED | 480 lines; exports `createChatStream`, `ToolConfigRow`, `ToolWithCredentials`, `CreateChatStreamParams` |
| `src/app/api/chat/[token]/route.ts` | Streaming POST handler — step 7 replaced with real AI engine | VERIFIED | 191 lines; returns `new Response(stream, ...)` with SSE headers |
| `tests/helpers/stream.ts` | readSseLines(res) helper | VERIFIED | 50 lines; exports `readSseLines`; imported by test suite |
| `tests/chat-api.test.ts` | Updated test suite — 10 tests covering all streaming behaviors | VERIFIED | 296 lines; all 10 tests GREEN confirmed by `npx vitest run` |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/app/api/chat/[token]/route.ts` | `src/lib/chat/stream.ts` | `import { createChatStream }` | WIRED | `route.ts:11` imports; used at `route.ts:170` |
| `src/lib/chat/stream.ts` | `src/lib/knowledge/query-knowledge.ts` | `queryKnowledge()` called before stream construction | WIRED | `stream.ts:10` imports; called at `stream.ts:208` |
| `src/lib/chat/stream.ts` | `src/lib/action-engine/execute-action.ts` | `executeAction()` called on tool_use stop | WIRED | `stream.ts:11` imports; called at `stream.ts:333` (OpenRouter) and `stream.ts:435` (Anthropic) |
| `src/app/api/chat/[token]/route.ts` | `src/lib/chat/persist.ts` | `after()` callback calls `persistMessage` for assistant reply | WIRED | `route.ts:163` calls `persistMessage` with `role: 'assistant'` inside `after()` |
| `tests/chat-api.test.ts` | `tests/helpers/stream.ts` | `import { readSseLines }` | WIRED | `test.ts:68` imports; used in 7 of 10 tests |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/lib/chat/stream.ts` | `kbResult` from `queryKnowledge` | `SupabaseVectorStore.similaritySearch` via `match_documents` RPC | Yes — LangChain vector similarity search against Supabase pgvector | FLOWING |
| `src/lib/chat/stream.ts` | `toolResult` from `executeAction` | `createContact` / `getAvailability` / `createAppointment` GHL executors | Yes — real GHL API calls dispatched by action_type switch | FLOWING |
| `src/app/api/chat/[token]/route.ts` | `toolRows` (ToolWithCredentials[]) | `supabase.from('tool_configs')` + `integrations` join + `decrypt()` | Yes — real DB query with is_active filter and credential decryption | FLOWING |
| `src/app/api/chat/[token]/route.ts` | `accumulatedReply` | `onReplyChunk` callback closure from `createChatStream` | Yes — populated by every token emitted during stream | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 10 chat-api tests pass | `npx vitest run tests/chat-api.test.ts` | 10/10 PASS, 1 file | PASS |
| Build compiles with no type errors | `npm run build` | `Compiled successfully in 17.1s` | PASS |
| CHAT-01: SSE response shape | Test assertion in vitest suite | session + token events + done confirmed | PASS |
| CHAT-02: queryKnowledge called | Test assertion in vitest suite | Called with correct args (message, org-1, supabase) | PASS |
| CHAT-03: tool_call event + executeAction | Test assertion in vitest suite | tool_call event found, executeAction called | PASS |
| D-12: degradation path | Test assertion in vitest suite | 200 status, "not yet configured" token, done event | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CHAT-01 | 03-01-PLAN, 03-02-PLAN | Visitor can send messages and receive streamed AI responses in real time (SSE) | SATISFIED | Route returns `text/event-stream`; session/token/done events emitted; Cache-Control: no-cache; 2 CHAT-01 tests GREEN |
| CHAT-02 | 03-01-PLAN, 03-02-PLAN | AI responses draw from the org's knowledge base (LangChain SupabaseVectorStore) | SATISFIED | `queryKnowledge()` called at `stream.ts:208` before LLM; result injected into system prompt; CHAT-02 test GREEN |
| CHAT-03 | 03-01-PLAN, 03-02-PLAN | AI can call org tools during conversation (action engine `executeAction`) | SATISFIED | `executeAction()` invoked on `finish_reason === 'tool_calls'` (OpenRouter) and `stop_reason === 'tool_use'` (Anthropic); `tool_call` SSE event emitted; CHAT-03 test GREEN |

No orphaned requirements — REQUIREMENTS.md traceability table maps CHAT-01, CHAT-02, CHAT-03 to Phase 3 (all marked Complete). All three requirement IDs declared in both plan frontmatters are covered.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/action-engine/execute-action.ts` | 41–43 | `send_sms` and `custom_webhook` throw `Unsupported action type` | Info | These are documented v2 stubs per REQUIREMENTS.md Future section; do not block phase goal |
| `src/app/api/chat/[token]/route.ts` | 115 | `return []` on empty rawTools | Info | Guard clause for empty DB result; downstream code handles it correctly — not a stub |

No blocker anti-patterns found.

---

## Human Verification Required

### 1. Real OpenRouter/Anthropic Streaming

**Test:** Configure an org with a real OpenRouter API key. Open the widget, send a message, and observe the browser's Network tab for the `/api/chat/[token]` response.
**Expected:** The response body should show streaming chunks arriving incrementally as text/event-stream. Each line should be a valid JSON object: first `{"event":"session",...}`, then multiple `{"event":"token","text":"..."}` lines, then `{"event":"done"}`.
**Why human:** Vitest mocks the OpenAI/Anthropic SDK. Only a live integration test can confirm the SSE protocol works end-to-end with real streaming from the provider.

### 2. Knowledge Base Integration Under Real Conditions

**Test:** Ensure the org has embedded documents. Send a message that should match a KB document. Verify that the AI response contains content from the knowledge base, not a generic answer.
**Expected:** The AI references specific information from the org's documents.
**Why human:** The mock in tests returns a fixed string. Only live traffic confirms that `queryKnowledge` actually retrieves relevant vectors from pgvector and that the context improves the LLM response.

### 3. Tool Call Round-Trip Live

**Test:** Configure an org with a `get_availability` tool_config pointing to a real GHL integration. Send a message like "What times are available tomorrow?" and observe whether the AI triggers a tool call.
**Expected:** A `{"event":"tool_call","name":"get_availability"}` event is emitted mid-stream, the action engine fetches real availability data from GHL, and the final reply includes the results.
**Why human:** Tool invocation depends on whether the LLM model chooses to call the tool given the real conversation; mocked tests force this path explicitly.

---

## Gaps Summary

No gaps. All phase 3 must-haves are fully satisfied:

- `src/lib/chat/stream.ts` (480 lines) implements the complete SSE streaming engine with OpenRouter primary path, Anthropic fallback, KB pre-retrieval, tool call round-trip, and D-12 degradation.
- `src/app/api/chat/[token]/route.ts` (191 lines) replaces the Phase 2 stub with a real streaming response, registers `after()` for persistence in the correct scope, and fetches + decrypts tool credentials via service-role client.
- `tests/helpers/stream.ts` (50 lines) provides the reusable SSE reader helper.
- `tests/chat-api.test.ts` (296 lines) runs 10/10 tests GREEN covering all required behaviors.
- Build compiles cleanly with no type errors.
- All three requirements (CHAT-01, CHAT-02, CHAT-03) are satisfied with implementation evidence.

---

_Verified: 2026-04-04T12:00:00Z_
_Verifier: Claude (gsd-verifier)_

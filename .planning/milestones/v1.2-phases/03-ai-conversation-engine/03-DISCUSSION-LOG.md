# Phase 3: AI Conversation Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-04
**Phase:** 03-ai-conversation-engine
**Areas discussed:** Streaming format, Tool call integration, System prompt + AI model, Message history window

---

## Streaming Format

| Option | Description | Selected |
|--------|-------------|----------|
| Plain SSE text chunks | Stream tokens as JSON-encoded SSE events. sessionId in first event. No AI SDK on client. Simplest for standalone JS widget. | ✓ |
| Vercel AI SDK data stream | Install `ai` package, use streamText + toDataStreamResponse(). AI SDK wire format. Needs React or custom parser on widget side. | |

**User's choice:** Plain SSE text chunks

| Option | Description | Selected |
|--------|-------------|----------|
| fetch + ReadableStream | Keep POST semantics. Client calls fetch(), reads response.body as a stream. Works with existing route shape. | ✓ |
| GET with EventSource | Switch to GET, move message/sessionId to query params. Allows native EventSource. Non-standard and awkward. | |

**User's choice:** fetch + ReadableStream

---

## Tool Call Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Full tool call integration | LLM gets org tools as AI tool definitions. executeAction() called on pick. CHAT-03 fully satisfied. | ✓ |
| KB-only, stub tool calls | Always queryKnowledge(), tools deferred. CHAT-03 partially satisfied only. | |

**User's choice:** Full tool call integration in Phase 3

| Option | Description | Selected |
|--------|-------------|----------|
| Query tool_configs table | Fetch org's active tool_configs rows at request start. Expose as LLM tool definitions. Consistent with Vapi action engine. | ✓ |
| Hardcode knowledge_base only | Always expose exactly one tool: knowledge_base search. Limits chat to Q&A only. | |

**User's choice:** Query tool_configs table

| Option | Description | Selected |
|--------|-------------|----------|
| Pause stream, call tool, resume | Stream tokens → emit tool_call event → run executeAction() → inject result → model continues. Widget shows loading state. | ✓ |
| Run tools before streaming | Non-streaming first pass to determine tool calls, then stream final answer. Simpler but adds latency. | |

**User's choice:** Pause stream, call tool, resume

---

## System Prompt + AI Model

| Option | Description | Selected |
|--------|-------------|----------|
| Org name + KB-grounded assistant | "You are a helpful assistant for {org.name}..." Phase 5 adds custom persona on top. | ✓ |
| Generic assistant, no org context | "You are a helpful assistant." Org persona entirely deferred to Phase 5. | |
| Fully configurable from DB | system_prompt column in DB, used directly. Requires schema change now. | |

**User's choice:** Org name + KB-grounded assistant

| Option | Description | Selected |
|--------|-------------|----------|
| Per-org key via getProviderKey() | Same pattern as queryKnowledge(). OpenRouter first, Anthropic fallback. No new env vars. | ✓ |
| Platform-level env var key | Shared ANTHROPIC_API_KEY. Simpler but platform pays for all chat. | |

**User's choice:** Per-org key via getProviderKey()

| Option | Description | Selected |
|--------|-------------|----------|
| Stream graceful error message | Emit "This assistant is not yet configured..." as SSE token. No HTTP error. Better UX. | ✓ |
| Return 500 / error event | HTTP 500 or error SSE event. Honest but confusing for widget visitors. | |

**User's choice:** Stream graceful error message when no API keys configured

---

## Message History Window

| Option | Description | Selected |
|--------|-------------|----------|
| Last 10 turns | Most recent 10 messages from ChatSessionContext.messages[]. Natural follow-up context, avoids token bloat. | ✓ |
| All messages in session | Pass entire messages array. Fine early in session, token/cost risk in long sessions. | |
| Configurable via env var | MAX_CHAT_HISTORY_TURNS env var. Flexible but over-engineering for v1.2. | |

**User's choice:** Last 10 turns

| Option | Description | Selected |
|--------|-------------|----------|
| Store both user and assistant turns | Post-stream: append assistant reply to Redis context + persist to Supabase via after(). Full history for follow-ups. | ✓ |
| Store user turns only | Only visitor messages stored. AI regenerates from scratch each time. | |

**User's choice:** Yes — store both user and assistant turns

---

## Claude's Discretion

- Exact Anthropic SDK streaming API method
- Whether KB retrieval is pre-RAG context injection or an LLM tool call
- Error handling granularity within the stream
- Token accumulation strategy for building full reply text before persistence

## Deferred Ideas

None — discussion stayed within phase scope.

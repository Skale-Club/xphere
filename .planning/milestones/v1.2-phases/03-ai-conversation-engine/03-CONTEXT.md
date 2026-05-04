# Phase 3: AI Conversation Engine - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the Phase 2 stub response (`reply: 'Message received.'`) with real streaming AI responses. The route already handles authentication, session management, and persistence — this phase wires in:
- Streamed SSE responses (CHAT-01)
- Knowledge base retrieval via `queryKnowledge()` (CHAT-02)
- Action engine tool calls via `executeAction()` (CHAT-03)

This phase does NOT add admin configuration, widget UI, or embed script — those are Phases 4 and 5.

</domain>

<decisions>
## Implementation Decisions

### Streaming Protocol
- **D-01:** Use `fetch + ReadableStream` on the POST route — keep POST semantics. No EventSource (which doesn't support POST bodies).
- **D-02:** Stream format: plain JSON-encoded SSE events, newline-delimited. Three event types:
  - `{"event":"session","sessionId":"<uuid>"}` — emitted once at start of stream before any tokens
  - `{"event":"token","text":"<chunk>"}` — one per streamed token
  - `{"event":"done"}` — signals stream complete
  - `{"event":"tool_call","name":"<action_type>"}` — optional, emitted when the model calls a tool mid-stream
- **D-03:** Response content type: `text/event-stream` with `Cache-Control: no-cache`.
- **D-04:** The route changes from returning `Response.json(...)` to returning a `Response` with a `ReadableStream` body. Existing test scaffolds (`tests/chat-api.test.ts`) test the stub behavior and will need to be updated for the streaming shape.

### Tool Call Integration
- **D-05:** Full tool call integration in Phase 3 (CHAT-03 is fully satisfied here, not deferred).
- **D-06:** Fetch the org's active `tool_configs` rows at request start. Expose each as an LLM tool definition. The LLM decides whether to call a tool.
- **D-07:** Tool call flow: stream tokens → model signals tool call → emit `tool_call` SSE event → run `executeAction()` → inject result into conversation → model continues streaming the final answer.
- **D-08:** Knowledge base retrieval (`queryKnowledge`) is also wired as a tool (or as pre-retrieval context injection — researcher should determine which approach the Anthropic/OpenRouter streaming APIs support cleanly).

### System Prompt
- **D-09:** Default system prompt: `"You are a helpful assistant for {org.name}. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so."` This is the Phase 3 placeholder — Phase 5 admin config will allow overriding it.
- **D-10:** No system_prompt column added to DB in this phase. Phase 5 owns that schema change.

### AI Model + Provider Routing
- **D-11:** Per-org API key routing via `getProviderKey()` — same pattern as `queryKnowledge()`:
  - Try OpenRouter first (`getProviderKey('openrouter', org.id, supabase)`) → stream via OpenAI-compatible client at `openrouter.ai`, model: `anthropic/claude-haiku-4-5`
  - Fall back to Anthropic SDK (`getProviderKey('anthropic', org.id, supabase)`) → stream via Anthropic streaming API, model: `claude-3-5-haiku-20241022`
- **D-12:** If the org has no API keys configured: stream a graceful degradation message as a single token event — `"This assistant is not yet configured. Please contact the site owner."` — then emit `done`. No HTTP error, no 500.
- **D-13:** No new environment variables needed. All provider credentials come from the existing integrations table.

### Message History Window
- **D-14:** Pass the last 10 message objects from `ChatSessionContext.messages[]` to the LLM per request. Older messages remain in Supabase for audit; the LLM only sees recent context.
- **D-15:** After the stream completes, store both turns:
  - Append assistant reply to `ChatSessionContext.messages[]` and call `setSession()` (Redis)
  - Call `persistMessage()` for the assistant reply (Supabase) — via `after()` so it doesn't block the response
- **D-16:** The assistant reply text is accumulated from streamed tokens before storing. The full text is not available until the stream ends, so persistence happens post-stream via `after()`.

### Claude's Discretion
- Exact Anthropic SDK streaming API (`.stream()` vs `.messages.create()` with `stream: true`) — researcher confirms
- Whether knowledge base retrieval happens as a pre-retrieval context injection (RAG before LLM call) or as an LLM tool call — researcher determines which fits the streaming pattern better
- Error handling granularity within the stream (e.g., tool call failures)
- Token accumulation strategy for building the full reply text before persistence

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing implementation to extend
- `src/app/api/chat/[token]/route.ts` — current stub route; Phase 3 replaces the stub response section (step 7) with streaming logic
- `src/lib/chat/session.ts` — `getSession`, `setSession`, `ChatSessionContext` — Phase 3 calls `setSession` after appending assistant reply
- `src/lib/chat/persist.ts` — `persistMessage` — Phase 3 calls this for the assistant reply via `after()`
- `src/lib/knowledge/query-knowledge.ts` — `queryKnowledge()` — Phase 3 integrates this as context retrieval
- `src/lib/action-engine/execute-action.ts` — `executeAction()` — Phase 3 exposes org tools and calls this when model picks a tool

### Provider + credential patterns
- `src/lib/integrations/get-provider-key.ts` — `getProviderKey(provider, orgId, supabase)` — use for OpenRouter and Anthropic key retrieval
- `src/lib/supabase/admin.ts` — `createServiceRoleClient()` — needed for tool_configs query (no auth session)

### DB schema
- `supabase/migrations/011_chat_schema.sql` — chat_sessions and chat_messages tables
- `supabase/migrations/012_org_widget_token.sql` — widget_token and session_key columns

### Project conventions
- `CLAUDE.md` — Node.js runtime for API routes, response patterns, Supabase auth patterns
- `.planning/codebase/CONVENTIONS.md` — Coding conventions, RLS patterns

### Reference chatbot (streaming pattern reference only)
- `C:\Users\Vanildo\Dev\chatbot\app\(chat)\api\chat\route.ts` — uses Vercel AI SDK `streamText`; review for streaming patterns but note Leaidear uses plain SSE, not AI SDK wire format

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `queryKnowledge(query, organizationId, supabase)` — fully implemented, handles OpenRouter/Anthropic fallback, org-scoped vector search. Phase 3 calls this to get KB context before or alongside the LLM call.
- `executeAction(actionType, params, credentials, ctx)` — fully implemented dispatcher. Phase 3 wraps it as an LLM-callable tool.
- `getProviderKey(provider, orgId, supabase)` — established pattern for per-org key retrieval. Phase 3 reuses for chat streaming.
- `getSession` / `setSession` from `src/lib/chat/session.ts` — Redis helpers already wired. Phase 3 adds `setSession` call post-stream.
- `persistMessage` from `src/lib/chat/persist.ts` — Supabase write helper. Phase 3 calls it for assistant replies via `after()`.

### Established Patterns
- `export const runtime = 'nodejs'` on the route — required; stays
- Per-org API key routing: try OpenRouter → fall back to Anthropic SDK
- Service-role client for all public API writes (no authenticated session)
- `after()` for fire-and-forget persistence (used for user message in Phase 2; same pattern for assistant reply)
- `ChatSessionContext.messages[]` accumulates full conversation history; slice to last 10 for LLM input

### Integration Points
- Phase 3 modifies step 7 of the existing route (the stub response block) — all earlier steps (auth, session, user message persist) remain unchanged
- The `tool_configs` table needs to be queried by org to discover available tools — same DB client as the rest of the route
- Phase 4 widget will consume the SSE stream format decided here — plain JSON events via `fetch + ReadableStream`

</code_context>

<specifics>
## Specific Ideas

- SSE protocol chosen: `{"event":"session","sessionId":"..."}` → `{"event":"token","text":"..."}` → `{"event":"done"}` — Phase 4 widget must implement this exact parser
- Tool call mid-stream: emit `{"event":"tool_call","name":"<action_type>"}` to let the widget show a "thinking..." or "looking up..." state
- Reference chatbot at `C:\Users\Vanildo\Dev\chatbot` uses Vercel AI SDK v6 (`ai` package) — reviewed for streaming patterns but Leaidear uses plain SSE without the AI SDK on either end
- No new npm packages are expected to be needed — Anthropic SDK and OpenAI SDK (for OpenRouter compat) are already installed

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-ai-conversation-engine*
*Context gathered: 2026-04-04*

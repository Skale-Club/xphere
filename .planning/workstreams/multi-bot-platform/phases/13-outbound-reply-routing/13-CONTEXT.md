# Phase 13: Outbound Reply Routing - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Mode:** auto

<domain>
## Phase Boundary

Modify the existing `POST /api/chat/conversations/[id]/messages` handler to branch on `conversation.channel` — widget messages continue unchanged (DB insert only), while messenger and instagram messages additionally call the Meta Send API using the decrypted page access token. Error code 190 (token revoked) returns a structured error that the UI surfaces as a reconnect prompt.

Does NOT include:
- Any UI changes (Phase 12 owns UI)
- New API routes — only modifying the existing messages route
- WhatsApp or other channels
- HUMAN_AGENT tag for post-24h replies (deferred)

</domain>

<decisions>
## Implementation Decisions

### Branch Strategy
- **D-01:** Modify the existing `POST /api/chat/conversations/[id]/messages` handler in `src/app/api/chat/conversations/[id]/messages/route.ts`. Branch on `conversation.channel` using a switch/if-else. No new route files. STATE.md explicitly decided this over a parallel route.
- **D-02:** Existing widget path is unchanged — DB insert + update last_message, no outbound API call. The SSE subscription already picks it up. Zero risk of regression.

### Send Lib
- **D-03:** Create `src/lib/meta/send-message.ts` with a single exported async function:
  `sendMetaMessage(pageToken: string, recipientId: string, text: string): Promise<{ messageId: string } | { error: string; code?: number }>`
  Uses the Meta Graph API: `POST https://graph.facebook.com/v21.0/me/messages` with `Authorization: Bearer {pageToken}`.
- **D-04:** This lib is the sole place that calls the Meta Send API — isolated for testing with vi.mock.

### Token Retrieval
- **D-05:** The POST handler must fetch `channel` and `channel_metadata` from the conversation (currently only fetches `id, org_id`). Add those fields to the existing SELECT.
- **D-06:** From `channel_metadata`: extract `page_id`. Query `meta_channels` by `page_id + org_id` (using `createServiceRoleClient()` to bypass RLS — meta_channels has org-scoped RLS but this route runs in org context).
  Actually: the route uses `createClient()` (user-scoped) so RLS scopes to the org automatically. Use `createClient()`.
- **D-07:** Decrypt `meta_channels.encrypted_page_access_token` using `decrypt()` from `@/lib/crypto`.
- **D-08:** `recipientId` determination:
  - `channel = 'instagram'` → `channel_metadata.igsid` (Instagram-scoped user ID)
  - `channel = 'messenger'` → `channel_metadata.sender_id` (page-scoped ID)

### Operation Order
- **D-09:** DB-first: insert the message to `conversation_messages` FIRST, then call `sendMetaMessage`. If Meta API fails after DB insert, the message is preserved (admin can see it was stored) and the error is surfaced to the UI. Prevents silent loss.
- **D-10:** If DB insert fails → return existing 500 error. If Meta send fails → return structured error (see D-11). Never roll back the DB insert.

### Error Handling
- **D-11:** Meta API error responses are classified:
  - Error code 190 (token expired/revoked) → `Response.json({ error: 'token_revoked', channel: conversation.channel }, { status: 400 })`
  - Other Meta errors → `Response.json({ error: 'meta_send_failed', message: meta_error_message }, { status: 502 })`
  - Missing meta_channels record → `Response.json({ error: 'channel_not_configured' }, { status: 400 })`
- **D-12:** The existing `ChatArea` reply form already handles non-200 responses from this route — Phase 12 wired error display. Phase 13 just needs to return the right status codes and error shapes.

### Claude's Discretion
- Exact field name in channel_metadata JSON for sender_id vs igsid — check process-event.ts from Phase 11 for the canonical names set during inbound processing
- Whether to use `after()` for the Meta send (probably NOT — the admin is waiting for send confirmation, so synchronous is correct here)
- Timeout for Meta API call — 10s with AbortController

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Modified File (Highest Risk)
- `src/app/api/chat/conversations/[id]/messages/route.ts` — existing POST handler to modify. Read fully before touching anything.

### Meta Send API
- `src/lib/meta/process-event.ts` — Phase 11 sets channel_metadata with igsid/sender_id/page_id — use exact same field names for extraction
- `src/lib/meta/oauth.ts` — META_GRAPH_VERSION constant (v21.0), getMetaEnv() pattern
- `src/lib/crypto.ts` — decrypt() function for page access token

### Database
- `supabase/migrations/019_meta_channels.sql` — meta_channels table: encrypted_page_access_token, page_id, channel_type
- `supabase/migrations/020_conversations_channel.sql` — channel + channel_metadata on conversations
- `src/types/database.ts` — TypeScript types

### Requirements
- `.planning/REQUIREMENTS.md` §METAINBOX — METAINBOX-03 only

### State Decision
- `.planning/STATE.md` — "Modify existing reply route (branch on channel) rather than create parallel route" (Key Decisions table)

</canonical_refs>

<code_context>
## Existing Code Insights

### Route to Modify
- Current POST handler at line 89 of `messages/route.ts`: fetches `id, org_id`, validates body (content + role), inserts to DB, updates conversation, returns message. Must extend the SELECT to include `channel, channel_metadata`.

### Reusable Assets
- `decrypt()` from `@/lib/crypto` — already used in process-event.ts and integrations
- `META_GRAPH_VERSION` from `@/lib/meta/oauth.ts` — reuse for API URL
- `createClient()` from `@/lib/supabase/server` — already imported in the route
- `createServiceRoleClient()` NOT needed — existing route already scoped by user auth (RLS handles org isolation)

### Integration Points
- `src/lib/meta/send-message.ts` (new) — called from the messages route after DB insert
- The route already has `import { createClient, getUser }` and `export const runtime = 'nodejs'`

</code_context>

<specifics>
## Specific Notes

- This is the HIGHEST RISK change in v1.3 — modifies the production message send path used by all widget conversations. Widget path must be completely unchanged.
- The channel_metadata from Phase 11 process-event.ts sets: `{ igsid, page_id }` for instagram and `{ sender_id, page_id }` for messenger. Use these exact keys.
- Meta Send API endpoint: `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages`
- Body format: `{ recipient: { id: recipientId }, message: { text }, messaging_type: "RESPONSE" }`
- Headers: `Authorization: Bearer {pageToken}`, `Content-Type: application/json`

</specifics>

<deferred>
## Deferred Ideas

- HUMAN_AGENT tag for replies after 24h window
- Read receipt passthrough from Meta webhook
- Retry logic for transient Meta API failures
- WhatsApp Send API
- Optimistic DB rollback on Meta failure (complex, not worth it for v1.3)

</deferred>

---

*Phase: 13-outbound-reply-routing*
*Context gathered: 2026-05-05*

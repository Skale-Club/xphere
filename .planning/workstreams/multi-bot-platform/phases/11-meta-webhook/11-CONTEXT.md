# Phase 11: Meta Webhook - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning
**Mode:** auto

<domain>
## Phase Boundary

Implement a unified `/api/meta/webhook` handler (GET verification + POST event processing) that receives inbound Instagram DMs and Messenger messages, creates conversations in the existing chat inbox with the correct channel type, fires configured automations (with keyword filtering), and enforces the 24h Meta messaging window.

Does NOT include:
- Inbox UI changes (Phase 12)
- Outbound reply routing (Phase 13)
- HUMAN_AGENT tag for post-24h replies (deferred)

</domain>

<decisions>
## Implementation Decisions

### Webhook Route
- **D-01:** Route at `src/app/api/meta/webhook/route.ts` — GET for hub challenge verification, POST for event processing. Export `runtime = 'nodejs'` (same as other webhook handlers). Always return HTTP 200 to Meta even on errors (never let Meta retry storm the server).
- **D-02:** HMAC-SHA256 signature verification using raw body — read via `request.text()` BEFORE any `JSON.parse()`. The `x-hub-signature-256` header contains `sha256=<hex>`. Use Node.js `crypto.createHmac` with `META_APP_SECRET`. Reject with 403 if signature invalid.
- **D-03:** `META_VERIFY_TOKEN` env var used for GET hub challenge verification. Must be added to `.env.local` and Vercel.

### Async Processing Model
- **D-04:** Use Next.js `after()` for async event processing. Return 200 immediately, then process the event asynchronously. This prevents Meta from timing out and retrying. No queue table needed — simpler architecture.
- **D-05:** If `after()` is unavailable (edge case), fall back to fire-and-forget with `void processMetaEvent(payload)` — still returns 200 synchronously.

### Conversation Creation
- **D-06:** Reuse existing `conversations` and `conversation_messages` tables. Set `channel = 'instagram' | 'messenger'` based on the `messaging_product` field in the webhook payload.
- **D-07:** `channel_metadata` JSONB stores: `{ igsid, page_id }` for Instagram; `{ sender_id, page_id }` for Messenger.
- **D-08:** De-duplicate: before creating a conversation, check if one already exists for `(channel, channel_metadata->>'igsid' OR sender_id, page_id)`. If yes, append message to existing conversation. If no, create new.
- **D-09:** Use `createServiceRoleClient()` inside the webhook handler (webhook runs without user auth context).

### Automation & Keyword Triggers
- **D-10:** Resolve automation from `meta_channels` table: look up by `page_id` + `channel_type`. The `meta_channels` record has `automation_id` (FK to automations). If null, no automation fires.
- **D-11:** Keyword trigger: check `meta_channels.config->>'keyword_trigger'` (nullable string). If set, only fire automation when `message.text.toLowerCase().includes(keyword.toLowerCase())`. If null/empty, fire on every message.
- **D-12:** Invoke automation via existing `executeAction` dispatcher from `src/lib/action-engine/`. Pass conversation_id, org_id, and message text as context.

### 24h Window Enforcement
- **D-13:** Track `last_inbound_at TIMESTAMPTZ` on the `conversations` table — add in a new migration (`022_conversation_inbound_at.sql`). Update on every inbound Meta message.
- **D-14:** Before firing automation, compute `now() - last_inbound_at`. If > 24 hours, skip automation and mark conversation with a flag (use `channel_metadata->>'window_expired' = 'true'`). No outbound message sent.
- **D-15:** No UI for window expiry in this phase — that's Phase 12. Just enforce the block silently and persist the flag.

### Claude's Discretion
- Error handling within `after()`: log errors to console, do not throw (would crash silently). Structured logging with `[meta/webhook]` prefix.
- Message deduplication by `mid` (Meta message ID): store in `conversation_messages.external_id` if column exists, else skip dedup.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Webhook Pattern
- `src/app/api/vapi/calls/route.ts` — Node.js runtime, always-200 pattern, service role client usage
- `src/app/api/meta/callback/route.ts` — Meta token exchange, cookie handling, existing Meta route structure
- `src/lib/meta/oauth.ts` — META_GRAPH_VERSION, META_CALLBACK_URI constants, getMetaEnv() helper

### Action Engine
- `src/lib/action-engine/` — executeAction dispatcher, how tools are invoked per org
- `src/lib/action-engine/resolve-org.ts` — how org is resolved from assistant context (adapt for Meta channel context)

### Database Schema
- `supabase/migrations/015_conversations.sql` — conversations table structure, bot_status field
- `supabase/migrations/019_meta_channels.sql` — meta_channels table: page_id, channel_type, automation_id, encrypted_page_access_token, config JSONB
- `supabase/migrations/020_conversations_channel.sql` — channel + channel_metadata columns on conversations
- `src/types/database.ts` — TypeScript types for all tables

### Requirements
- `.planning/REQUIREMENTS.md` §METAEV — METAEV-01 through METAEV-05 (all five must be satisfied)

### State Notes
- `.planning/STATE.md` — Raw body must be read as text before HMAC verification (`request.text()`, not `request.json()`); after() preferred over queue table

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createServiceRoleClient()` from `src/lib/supabase/admin.ts` — use in webhook handler (no user auth context)
- `executeAction` from `src/lib/action-engine/` — existing automation dispatcher
- `getMetaEnv()` from `src/lib/meta/oauth.ts` — reads META_APP_ID + META_APP_SECRET
- `decrypt()` from `src/lib/crypto.ts` — needed to decrypt stored page access token before any Meta API call

### Established Patterns
- Webhook handlers: `export const runtime = 'nodejs'`, always return `Response.json({ ok: true })` even on error
- Service role client: used in all `/api/vapi/` handlers, appropriate here too
- channel + channel_metadata: already on conversations table from migration 020

### Integration Points
- New route: `src/app/api/meta/webhook/route.ts`
- New migration: `supabase/migrations/022_conversation_inbound_at.sql` (adds `last_inbound_at` to conversations)
- Reads from: `meta_channels` (get automation_id, page token, keyword trigger)
- Writes to: `conversations`, `conversation_messages`

</code_context>

<specifics>
## Specific Notes

- Meta webhook sends a single POST with potentially multiple entries and multiple messages per entry — the handler must loop over `entry[].messaging[]`
- Instagram uses `sender.id` = IGSID (Instagram-scoped user ID); Messenger uses `sender.id` = PSID (page-scoped user ID)
- Both Instagram and Messenger are delivered to the same webhook endpoint — distinguish by `messaging_product` or by which page_id matches which channel_type in `meta_channels`
- `META_VERIFY_TOKEN` is a new env var needed (simple random string, not a secret API key)

</specifics>

<deferred>
## Deferred Ideas

- HUMAN_AGENT tag for replies after 24h window — requires separate Meta App Review submission
- Webhook event queue table (meta_webhook_queue) — after() is sufficient for now
- Read receipts / seen indicators from Meta events
- Typing indicator passthrough

</deferred>

---

*Phase: 11-meta-webhook*
*Context gathered: 2026-05-04*

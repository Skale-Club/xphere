# Chat Data Boundary

> **Audience:** Anyone touching chat persistence code (`src/lib/chat/`, `src/app/api/chat/`, `src/components/chat/`).
> **Question this answers:** "When is `chat_sessions` written? When is `conversations` written? Where does a widget message end up?"

---

## TL;DR

There is **only one persistence world** for chat data: the **`conversations` + `conversation_messages`** tables. There is no separate `chat_sessions` or `chat_messages` table — those names are historical and have been renamed (see Phase 14 testfix).

Redis is a **transient cache** of recent message context for the public widget API only. It is not a parallel persistence world. If Redis is unavailable, the widget continues to work — every write also goes to Postgres.

---

## Tables (Postgres, Supabase)

### `conversations`

One row per chat session, regardless of channel. Created when a visitor first sends a widget message OR when a Meta inbound webhook arrives for an unknown sender.

Key columns:
- `id` (uuid PK) — server-generated, the canonical conversation identifier
- `org_id` (uuid FK → organizations) — tenant scope (RLS enforces isolation)
- `widget_token` (text NOT NULL) — empty string `''` for Meta-channel rows; the org's widget token for widget rows
- `session_key` (text) — visitor-facing UUID for widget conversations (sent to client, used to resume context); null for Meta channels
- `channel` (text DEFAULT `'widget'`) — `'widget'` | `'instagram'` | `'messenger'`
- `channel_metadata` (jsonb DEFAULT `{}`) — channel-specific shape:
  - widget: empty object
  - messenger: `{ sender_id, page_id }`
  - instagram: `{ igsid, page_id, window_expired? }`
- `bot_status` (text DEFAULT `'active'`) — `'active'` | `'paused'` (admin can pause automation per-conversation)
- `last_message`, `last_message_at`, `last_inbound_at` — preview/timing fields used by the inbox list and the 24h Meta window check
- `customer_name`, `customer_number` — visitor identity (when available)

### `conversation_messages`

One row per message in a conversation.

Key columns:
- `id` (uuid PK)
- `conversation_id` (uuid FK → conversations)
- `org_id` (uuid FK → organizations)
- `role` (text) — `'user'` | `'assistant'`
- `content` (text)
- `metadata` (jsonb) — optional, used by the chat stream for `tool_call` / `tool_result` / `error` debug bubbles
- `created_at` (timestamptz)

---

## Redis (transient — not a database)

Redis stores a short-lived session **cache** for the public widget API. Key shape:

```
chat:session:{sessionId}   →   JSON blob with last 10 message turns + orgId + dbSessionId
TTL: 1 hour, sliding window — refreshed on every message
```

The Redis cache exists so that consecutive widget messages within the same hour can build context without hitting Postgres for the message history every time.

**If Redis is unavailable** (down, misconfigured, or `REDIS_URL` unset), the widget API silently degrades — `getSession()` returns `null`, callers re-create context from scratch each request, and the chat continues to work but without the in-memory shortcut. See `src/lib/chat/session.ts`.

Redis is **never** the source of truth. Every persisted message lands in `conversation_messages`. Every conversation lands in `conversations`. The Redis blob is reconstructable from those two tables.

---

## Lifecycle: How a widget message reaches the admin inbox

1. Visitor types a message in the embedded widget (`<script src=".../widget.js">`)
2. Widget POSTs to `/api/chat/[token]` (the public chat route)
3. The route resolves the org via `widget_token` lookup on `organizations`
4. The route checks Redis for `chat:session:{sessionId}` (might be there from a prior message in the same hour)
5. If Redis miss or new session → call `ensureDbSession()` from `src/lib/chat/persist.ts`:
   - INSERT a row into **`conversations`** with `channel='widget'`, `widget_token`, `session_key`, `org_id`
   - Returns the new row's `id` as `dbSessionId`
6. Call `persistMessage({ role: 'user', content })`:
   - INSERT into **`conversation_messages`** (conversation_id, org_id, role, content)
   - UPDATE **`conversations`** preview fields (`last_message`, `last_message_at`, `updated_at`)
7. Stream LLM tokens back via SSE; once done, call `persistMessage({ role: 'assistant', content: accumulatedReply })` via `after()`
8. Update Redis cache with the new context window (10 most recent messages) for next call
9. Admin inbox queries `conversations` (and joins `conversation_messages`) — the message is already there

**Key insight:** Steps 5, 6, 7 all write to the **same `conversations`/`conversation_messages` tables** that the admin inbox reads. The inbox does not have its own data world.

---

## Lifecycle: How a Meta DM (Instagram/Messenger) reaches the admin inbox

1. Meta sends a webhook to `/api/meta/webhook` (POST event from Instagram or Messenger)
2. Route verifies HMAC signature, returns 200 immediately, processes async via `after()`
3. `processMetaEvent()` in `src/lib/meta/process-event.ts`:
   - Looks up the page in `meta_channels` to find the bound automation and decrypted page token
   - Checks if a `conversations` row already exists for this `(channel, sender_id_or_igsid, page_id)` — de-duplication by metadata
   - If new → INSERT into **`conversations`** with `channel='instagram' | 'messenger'`, `widget_token=''`, `channel_metadata={ igsid|sender_id, page_id }`, `org_id` from meta_channels
   - INSERT inbound message into **`conversation_messages`**
   - UPDATE preview fields and `last_inbound_at` on the conversations row
   - If automation bound + within 24h window + bot_status='active' → fire `executeAction()` and persist its assistant reply to `conversation_messages`
4. Admin inbox queries `conversations` — Meta conversations appear alongside widget conversations, distinguished by `channel`

**Key insight:** Meta channels share the same tables as widget. The `channel` column is the discriminator. The admin inbox renders all three identically except for the icon/label.

---

## Outbound replies from the admin inbox

When an admin types a reply in `/chat`, the route `POST /api/chat/conversations/[id]/messages`:

1. SELECTs the conversation including `channel` and `channel_metadata`
2. INSERTs the reply into **`conversation_messages`**
3. UPDATEs preview fields on **`conversations`**
4. **Then branches on channel:**
   - `widget` → done (the widget polls / receives via SSE on its next request)
   - `messenger` / `instagram` → fetch page token from `meta_channels`, call `sendMetaMessage()` to deliver via Meta Graph API
5. If the Meta send fails (e.g. token revoked, code 190), return a structured error so the UI can surface a reconnect prompt — but the DB insert is preserved (visible in admin's own inbox).

---

## Files Involved

| File | Role |
|------|------|
| `src/lib/chat/persist.ts` | `ensureDbSession()` and `persistMessage()` — the only two writers for widget chat |
| `src/lib/chat/session.ts` | Redis cache helpers — read-through, write-through, graceful degrade |
| `src/lib/meta/process-event.ts` | Meta inbound — creates conversations + messages from webhook |
| `src/app/api/chat/[token]/route.ts` | Public widget API — calls persist + session helpers + stream |
| `src/app/api/meta/webhook/route.ts` | Meta inbound webhook — HMAC verify + dispatch to processMetaEvent |
| `src/app/api/chat/conversations/[id]/messages/route.ts` | Admin reply route — inserts message + branches on channel |
| `src/components/chat/conversation-list.tsx` | Admin inbox list — reads conversations |
| `src/components/chat/chat-area.tsx` | Admin inbox detail — reads conversation_messages |

---

## Why two channel models?

There are no two channel models. There is one model — `conversations` with a `channel` column — and a Redis cache used only by the public widget API.

If you ever find code that writes to a `chat_sessions` or `chat_messages` table, that's a bug or a relic from before the rename. Update it to use `conversations` / `conversation_messages` (see Phase 14 testfix for the canonical migration pattern in tests).

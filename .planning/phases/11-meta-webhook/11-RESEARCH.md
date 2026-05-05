# Phase 11: Meta Webhook - Research

**Researched:** 2026-05-04
**Domain:** Meta Webhooks (Instagram DM + Messenger) · Next.js Route Handlers · HMAC-SHA256 Verification · Conversation Creation · Automation Dispatch
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Route at `src/app/api/meta/webhook/route.ts` — GET for hub challenge verification, POST for event processing. Export `runtime = 'nodejs'`. Always return HTTP 200 to Meta even on errors.
- **D-02:** HMAC-SHA256 signature verification using raw body — read via `request.text()` BEFORE any `JSON.parse()`. The `x-hub-signature-256` header contains `sha256=<hex>`. Use Node.js `crypto.createHmac` with `META_APP_SECRET`. Reject with 403 if signature invalid.
- **D-03:** `META_VERIFY_TOKEN` env var used for GET hub challenge verification. Must be added to `.env.local` and Vercel.
- **D-04:** Use Next.js `after()` for async event processing. Return 200 immediately, then process the event asynchronously. No queue table needed.
- **D-05:** If `after()` is unavailable (edge case), fall back to fire-and-forget with `void processMetaEvent(payload)`.
- **D-06:** Reuse existing `conversations` and `conversation_messages` tables. Set `channel = 'instagram' | 'messenger'` based on webhook payload.
- **D-07:** `channel_metadata` JSONB stores `{ igsid, page_id }` for Instagram; `{ sender_id, page_id }` for Messenger.
- **D-08:** De-duplicate conversations by `(channel, igsid OR sender_id, page_id)` before creating a new one.
- **D-09:** Use `createServiceRoleClient()` inside the webhook handler.
- **D-10:** Resolve automation from `meta_channels` by `page_id` + `channel_type`. Null `automation_id` = no automation fires.
- **D-11:** Keyword trigger via `meta_channels.config->>'keyword_trigger'`. Null/empty = fire on every message.
- **D-12:** Invoke automation via existing `executeAction` dispatcher from `src/lib/action-engine/`.
- **D-13:** Track `last_inbound_at TIMESTAMPTZ` on `conversations` — add in migration `022_conversation_inbound_at.sql`.
- **D-14:** Before firing automation, check `now() - last_inbound_at`. If > 24 hours, skip automation and set `channel_metadata->>'window_expired' = 'true'`.
- **D-15:** No UI for window expiry in this phase (Phase 12). Enforce silently and persist the flag.
- **Discretion:** Error handling within `after()`: log errors to console, do not throw. Structured logging with `[meta/webhook]` prefix. Message deduplication by `mid` stored in `conversation_messages.external_id` if column exists, else skip.

### Deferred Ideas (OUT OF SCOPE)

- HUMAN_AGENT tag for replies after 24h window
- Webhook event queue table (meta_webhook_queue)
- Read receipts / seen indicators from Meta events
- Typing indicator passthrough
- Inbox UI changes (Phase 12)
- Outbound reply routing (Phase 13)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| METAEV-01 | System receives and verifies inbound events from Instagram and Messenger via a single unified Meta webhook (HMAC-SHA256 signature verification) | GET hub challenge + POST HMAC verification pattern documented below |
| METAEV-02 | Inbound Meta messages create conversations in the existing chat inbox with the correct channel type (`instagram` or `messenger`) | Conversation creation pattern using existing tables with channel + channel_metadata columns |
| METAEV-03 | Automation bound to a Meta channel fires on incoming messages and can invoke existing action engine tools (`executeAction`) | Action engine integration pattern — resolve from meta_channels, call executeAction |
| METAEV-04 | Automation supports keyword triggers — fires when message contains a configured keyword | Keyword matching against meta_channels.config->>'keyword_trigger' |
| METAEV-05 | System enforces the 24h Meta messaging window — automated replies are blocked after 24h from last inbound user message | last_inbound_at column + 24h window check before automation dispatch |
</phase_requirements>

---

## Summary

Phase 11 implements a unified `/api/meta/webhook/route.ts` handler that is the sole inbound event receiver for both Instagram DMs and Messenger messages. The existing project stack (Next.js 16.2.2, Supabase, Node.js runtime) already contains all required primitives: the `after()` function is confirmed available in `next/server`, the service role client is established in `src/lib/supabase/admin.ts`, the action engine dispatcher is in `src/lib/action-engine/execute-action.ts`, and the conversations/conversation_messages tables have the `channel` and `channel_metadata` columns.

The most important architectural fact discovered during research is a schema gap: the `meta_channels` table (migration 019) does NOT have a `config` JSONB column, but decision D-11 depends on `meta_channels.config->>'keyword_trigger'`. Migration 022 must add both `last_inbound_at` to conversations AND `config JSONB DEFAULT '{}'` to meta_channels. Additionally, the `conversation_messages` table has no `external_id` column for message-level deduplication by `mid` — the discretion note in CONTEXT.md says to skip dedup if the column doesn't exist, which is the correct fallback.

The Meta webhook payload shape is well-documented and consistent: Instagram payloads set `object = "instagram"`, Messenger payloads set `object = "page"`. Both share the same `entry[].messaging[]` structure, making a single handler straightforward to write. HMAC verification via `crypto.createHmac('sha256', META_APP_SECRET)` on the raw body string (read via `request.text()`) is the critical security requirement.

**Primary recommendation:** Implement in two plans — Wave 0 (RED test stubs + migration 022) and Wave 1 (webhook route + processMetaEvent logic). The migration must land first so TypeScript types can be updated before the handler is written.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next/server` (`after`) | 16.2.2 (stable) | Async post-response processing | Already installed; avoids Meta timeout with fire-and-forget |
| Node.js `crypto` (built-in) | N/A | HMAC-SHA256 signature verification | Required by D-02; Web Crypto API not used here (Node.js runtime) |
| `@supabase/supabase-js` | 2.101.1 | DB reads/writes in webhook handler | Already used in all `/api/vapi/*` handlers |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `createServiceRoleClient` | internal | Bypass RLS in webhook context | All reads/writes in the webhook handler (no user auth) |
| `decrypt` from `src/lib/crypto.ts` | internal | Decrypt page access token | Only needed if Phase 11 makes outbound API calls (it does NOT — Phase 13 handles that) |
| `executeAction` from `src/lib/action-engine/execute-action.ts` | internal | Dispatch automation | Called inside `after()` callback when automation is configured |

**Note:** `decrypt` is listed for awareness — Phase 11 does NOT make outbound Meta API calls. It only reads the `encrypted_page_access_token` to confirm the channel record exists; the actual decryption for outbound sends is Phase 13's concern. Phase 11 needs `decrypt` only if it must validate the token is readable (it doesn't — skip decrypt in Phase 11).

**Installation:** No new npm packages required. All dependencies are built-in or already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
  app/api/meta/
    callback/route.ts      # existing OAuth callback
    webhook/route.ts       # NEW: GET verification + POST event handler
  lib/meta/
    oauth.ts               # existing helpers (getMetaEnv re-used)
    process-event.ts       # NEW: pure function - processMetaEvent(payload, supabase)
supabase/migrations/
  022_conversation_inbound_at.sql   # NEW: adds last_inbound_at + meta_channels.config
```

The `processMetaEvent` function should be extracted into `src/lib/meta/process-event.ts` rather than inlined in the route — this makes it independently testable without mocking the HTTP layer.

### Pattern 1: GET Hub Challenge Verification

**What:** Meta sends a GET request with `hub.mode`, `hub.verify_token`, `hub.challenge` before activating the webhook subscription.
**When to use:** Must handle on every GET to `/api/meta/webhook`.

```typescript
// Source: Meta Webhook documentation + messengerbot.app guide (2026)
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}
```

### Pattern 2: HMAC-SHA256 Signature Verification (POST)

**What:** Verify the `x-hub-signature-256` header against HMAC of raw body.
**Critical:** Raw body MUST be read as `request.text()` BEFORE any JSON parsing.

```typescript
// Source: Meta platform docs + community forum confirmation
import { createHmac, timingSafeEqual } from 'node:crypto'

function verifyMetaSignature(rawBody: string, signature: string | null): boolean {
  if (!signature?.startsWith('sha256=')) return false
  const secret = process.env.META_APP_SECRET
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const received = signature.slice('sha256='.length)
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
  } catch {
    return false
  }
}
```

### Pattern 3: POST Handler with after()

**What:** Return 200 immediately, process asynchronously in `after()`.

```typescript
// Source: https://nextjs.org/docs/app/api-reference/functions/after (v16.2.2)
import { after } from 'next/server'

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature-256')

    if (!verifyMetaSignature(rawBody, signature)) {
      console.warn('[meta/webhook] Invalid signature — rejected')
      return new Response(null, { status: 403 })
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return Response.json({ ok: true })
    }

    after(async () => {
      try {
        await processMetaEvent(payload)
      } catch (err) {
        console.error('[meta/webhook] processMetaEvent error:', err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[meta/webhook] Outer error:', err)
    return Response.json({ ok: true })
  }
}
```

### Pattern 4: Payload Shape — Instagram vs Messenger

Both channels use the same `entry[].messaging[]` iteration. The `object` field distinguishes them.

```typescript
// Source: Meta Webhook documentation (verified 2026-05-04)
// Instagram DM:
{
  "object": "instagram",
  "entry": [{
    "id": "IGID",            // Instagram Professional account ID (= recipient.id)
    "time": 1569262486134,
    "messaging": [{
      "sender": { "id": "IGSID" },     // Instagram-scoped user ID
      "recipient": { "id": "IGID" },
      "timestamp": 1569262485349,
      "message": { "mid": "MESSAGE-ID", "text": "MESSAGE-TEXT" }
    }]
  }]
}

// Messenger:
{
  "object": "page",
  "entry": [{
    "id": "PAGE_ID",
    "time": 1234567890000,
    "messaging": [{
      "sender": { "id": "USER_PSID" }, // Page-scoped user ID
      "recipient": { "id": "PAGE_ID" },
      "timestamp": 1234567890000,
      "message": { "mid": "mid.1234567890123", "text": "user message content" }
    }]
  }]
}
```

**Channel mapping:**
- `object === "instagram"` → `channel = 'instagram'`, `channel_metadata = { igsid: sender.id, page_id: entry.id }`
- `object === "page"` → `channel = 'messenger'`, `channel_metadata = { sender_id: sender.id, page_id: entry.id }`

**Important:** Both `object` values map to `meta_channels` rows via `page_id` (entry.id). The `channel_type` on the meta_channels row (`'instagram'` or `'messenger'`) further scopes the lookup.

### Pattern 5: Conversation De-duplication

Before inserting, check if a conversation already exists for this sender + page:

```typescript
// For Instagram:
const { data: existing } = await supabase
  .from('conversations')
  .select('id, last_inbound_at')
  .eq('channel', 'instagram')
  .eq('channel_metadata->>igsid', senderId)
  .eq('channel_metadata->>page_id', pageId)
  .limit(1)
  .maybeSingle()

// For Messenger:
const { data: existing } = await supabase
  .from('conversations')
  .select('id, last_inbound_at')
  .eq('channel', 'messenger')
  .eq('channel_metadata->>sender_id', senderId)
  .eq('channel_metadata->>page_id', pageId)
  .limit(1)
  .maybeSingle()
```

**Note:** The `conversations` table uses `service role client` here — no RLS scope needed. The `org_id` is resolved from `meta_channels` by `page_id`.

### Pattern 6: Org Resolution from Meta Webhook

There is no `assistant_mappings` equivalent for Meta. Org is resolved via `meta_channels`:

```typescript
const { data: channel } = await supabase
  .from('meta_channels')
  .select('org_id, automation_id, config')
  .eq('page_id', pageId)
  .eq('channel_type', channelType)  // 'instagram' or 'messenger'
  .eq('is_active', true)
  .maybeSingle()

if (!channel) {
  console.warn('[meta/webhook] No active meta_channel for page_id:', pageId)
  return
}
const orgId = channel.org_id
```

### Pattern 7: Action Engine Integration for Meta Context

The existing `executeAction` expects `GhlCredentials` — this is for GHL-backed actions. The Meta automation dispatch is simpler: the automation tool config is resolved by `automation_id` (UUID FK on meta_channels), not by tool name.

```typescript
// Resolve the tool_config row directly by ID
const { data: toolConfig } = await supabase
  .from('tool_configs')
  .select('*, integrations!inner(*)')
  .eq('id', channel.automation_id)
  .single()

// Decrypt credentials and call executeAction
const apiKey = await decrypt(toolConfig.integrations.encrypted_api_key)
const result = await executeAction(
  toolConfig.action_type,
  { message: messageText, conversation_id: conversationId },
  { apiKey, locationId: toolConfig.integrations.location_id ?? '' },
  { organizationId: orgId, supabase }
)
```

### Pattern 8: 24h Window Enforcement

```typescript
const lastInboundAt = existingConversation?.last_inbound_at
  ? new Date(existingConversation.last_inbound_at)
  : null

const windowExpired = lastInboundAt
  ? (Date.now() - lastInboundAt.getTime()) > 24 * 60 * 60 * 1000
  : false

if (windowExpired) {
  // Merge window_expired flag into existing channel_metadata
  await supabase
    .from('conversations')
    .update({
      channel_metadata: { ...existingChannelMetadata, window_expired: 'true' },
      last_inbound_at: new Date().toISOString(),  // reset on new message
    })
    .eq('id', conversationId)
  console.log('[meta/webhook] 24h window expired — skipping automation')
  return
}

// Reset window_expired when a new message arrives within window
await supabase
  .from('conversations')
  .update({ last_inbound_at: new Date().toISOString(), channel_metadata: { ...meta, window_expired: 'false' } })
  .eq('id', conversationId)
```

**Important nuance:** When a new message arrives, `last_inbound_at` should always be updated — even if automation is blocked. The window_expired flag means "the window was expired at time of last check," not a permanent lock. A new inbound message resets the window.

### Anti-Patterns to Avoid

- **Parsing JSON before HMAC check:** Parsing transforms the body; HMAC must be over the exact raw bytes sent by Meta.
- **Using `request.json()` in the Meta webhook:** Always use `request.text()` for webhook bodies where HMAC is involved.
- **Returning non-200 on logic errors:** Meta retries aggressively on non-200. Return 200 even if processing fails.
- **Processing all messaging entries synchronously before responding:** Use `after()` to process after the 200 is returned.
- **Manually filtering by org_id when using service role client with RLS bypass:** Service role bypasses RLS; org_id must be resolved from meta_channels, not from an auth context.
- **Assuming `messaging_product` distinguishes Instagram from Messenger:** The top-level `object` field (`"instagram"` vs `"page"`) is the correct discriminator. `messaging_product` is a Messenger-era field not always present.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC verification | Custom string comparison | `timingSafeEqual` from `node:crypto` | Timing attacks via branch-based comparison |
| Post-response async work | Background setTimeout / setInterval | `after()` from `next/server` | `setTimeout` does not survive Vercel serverless lifecycle; `after()` uses `waitUntil` internally |
| Service role DB client | New Supabase client construction inline | `createServiceRoleClient()` from `src/lib/supabase/admin.ts` | Consistency, avoids duplicating env var access |
| Credential decryption | Re-implement AES-GCM | `decrypt()` from `src/lib/crypto.ts` | AES-256-GCM format must not change (CLAUDE.md sensitive path) |
| Action dispatch | Custom action router | `executeAction()` from action-engine | Already handles all action types with proper error handling |

**Key insight:** The project's service-role pattern, action engine, and crypto module are proven and hardened. Reusing them prevents drift between the Meta and Vapi webhook paths.

---

## Runtime State Inventory

Step 2.5: SKIPPED — This is a greenfield feature phase, not a rename/refactor/migration phase. No runtime state inventory required.

---

## Environment Availability Audit

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Webhook handler runtime | Yes | (Vercel managed) | — |
| `next/server` `after()` | Async post-response processing | Yes | 16.2.2 (stable since 15.1.0) | fire-and-forget `void processMetaEvent()` (D-05) |
| `node:crypto` (built-in) | HMAC-SHA256 verification | Yes | built-in | — |
| `META_APP_SECRET` env var | HMAC verification | Must be set | — | 403 on all POSTs until set |
| `META_VERIFY_TOKEN` env var | GET hub challenge | Must be set | — | 403 on all GETs until set |
| `SUPABASE_SERVICE_ROLE_KEY` env var | Service role client | Yes (existing) | — | — |
| `ENCRYPTION_SECRET` env var | decrypt() calls (Phase 13, not 11) | Yes (existing) | — | — |

**Missing dependencies with no fallback:**
- `META_VERIFY_TOKEN` must be added to `.env.local` and Vercel before the webhook route can pass hub challenge verification. This is a simple random string (not a cryptographic secret).
- `META_APP_SECRET` must already be set (was required for Phase 10 OAuth) — confirm it is present in production Vercel env vars.

---

## Schema Gaps (Critical Findings)

Two schema gaps found that affect this phase:

### Gap 1: `meta_channels.config` column does not exist

**Finding:** Migration 019 (`019_meta_channels.sql`) creates the `meta_channels` table WITHOUT a `config JSONB` column. Decision D-11 requires `meta_channels.config->>'keyword_trigger'` for keyword filtering. The TypeScript types (`src/types/database.ts`) also do not include `config` on the `meta_channels` Row/Insert/Update shapes.

**Resolution:** Migration 022 must add `config JSONB NOT NULL DEFAULT '{}'` to `meta_channels` in addition to `last_inbound_at` on `conversations`. TypeScript types must be updated to include `config: Json` on `meta_channels.Row`, `meta_channels.Insert`, and `meta_channels.Update`.

**Alternative:** Use a separate migration number (023) if 022 is reserved for conversations only, but a single migration is simpler.

### Gap 2: `conversation_messages.external_id` column does not exist

**Finding:** The `conversation_messages` table (migration 015) has no `external_id` column for storing the Meta message `mid`. CONTEXT.md discretion note acknowledges this: "store in `conversation_messages.external_id` if column exists, else skip dedup."

**Resolution:** Skip message-level deduplication by `mid` in Phase 11. This is an accepted tradeoff per D-05 discretion. If mid deduplication becomes needed, it can be added in a future migration. The conversation-level deduplication (by sender_id + page_id) is sufficient for Phase 11.

---

## Common Pitfalls

### Pitfall 1: Reading JSON Before HMAC Verification
**What goes wrong:** The computed HMAC does not match Meta's signature because the body was re-serialized after JSON parsing, altering whitespace or character escaping.
**Why it happens:** Developers call `request.json()` instead of `request.text()`, then try to re-stringify for HMAC.
**How to avoid:** Always call `request.text()` first, store the raw string, then call `JSON.parse(rawBody)`.
**Warning signs:** Signature validation fails in tests but works when checking manually.

### Pitfall 2: Non-200 Responses Causing Meta Retry Storms
**What goes wrong:** Meta retries the webhook aggressively when it receives a non-200 response, flooding the server.
**Why it happens:** Unhandled exceptions escape the outer try/catch and Next.js returns a 500.
**How to avoid:** Two-level try/catch: outer catch returns `Response.json({ ok: true })` even on unknown errors. Inner catch handles expected errors.
**Warning signs:** Multiple identical webhook deliveries appearing in Meta App Dashboard.

### Pitfall 3: Processing Multiple Entries/Messages in Wrong Order
**What goes wrong:** Meta can batch multiple entries and multiple messages per entry in a single POST body. Processing only `entry[0].messaging[0]` drops messages.
**Why it happens:** Sample code often shows single entry/message for simplicity.
**How to avoid:** Always loop: `for (const entry of payload.entry) { for (const event of entry.messaging) { ... } }`.
**Warning signs:** Some test messages don't appear in the inbox.

### Pitfall 4: Confusing `entry.id` (page_id) with `recipient.id`
**What goes wrong:** For Instagram, `entry.id` is the IGID (Instagram account ID), but `recipient.id` inside `messaging[]` is also the IGID. These should be the same value; if they differ, use `entry.id` for looking up the `meta_channels` record (it is the `page_id` field).
**Why it happens:** For Messenger, `entry.id` = `PAGE_ID` and `recipient.id` = `PAGE_ID` are also both the page ID. The key lookup should always use `entry.id`.
**How to avoid:** Use `entry.id` as the authoritative `page_id` for `meta_channels` lookup.

### Pitfall 5: Window Expiry Permanent Lock
**What goes wrong:** Setting `window_expired = 'true'` and never resetting it means a conversation remains locked even after a new message arrives.
**Why it happens:** Mixing up "the window was expired" (historical state) with "the window is currently expired" (present check).
**How to avoid:** Always update `last_inbound_at` on every inbound message regardless of window state. Recompute expiry dynamically from `last_inbound_at` on each webhook call rather than relying on a cached flag.

### Pitfall 6: Service Role Client Bypasses RLS Unexpectedly
**What goes wrong:** Queries with service role return data from ALL orgs, not just the org scoped by `page_id`.
**Why it happens:** RLS is bypassed for service role — no `get_current_org_id()` scoping applies.
**How to avoid:** Always add explicit `.eq('org_id', resolvedOrgId)` or `.eq('page_id', pageId)` when using service role client. Never rely on implicit org scoping.

### Pitfall 7: `config` Column Absent Causes TypeScript Errors
**What goes wrong:** Accessing `channelRow.config` throws a TypeScript error because the column is not in the database types.
**Why it happens:** Migration 019 didn't include `config` and the types weren't updated.
**How to avoid:** Migration 022 adds the column, types are updated before Wave 1 implementation begins.

---

## Code Examples

### Full processMetaEvent Skeleton

```typescript
// src/lib/meta/process-event.ts
// Source: Derived from existing vapi/tools pattern + Meta webhook docs
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeAction } from '@/lib/action-engine/execute-action'
import { decrypt } from '@/lib/crypto'

type MetaWebhookPayload = {
  object: string
  entry: Array<{
    id: string
    time: number
    messaging: Array<{
      sender: { id: string }
      recipient: { id: string }
      timestamp: number
      message?: { mid: string; text?: string }
    }>
  }>
}

export async function processMetaEvent(payload: MetaWebhookPayload): Promise<void> {
  const supabase = createServiceRoleClient()

  for (const entry of payload.entry) {
    const pageId = entry.id
    const channelType = payload.object === 'instagram' ? 'instagram' : 'messenger'

    for (const event of entry.messaging) {
      // Skip non-message events (delivery, read, echo)
      if (!event.message?.text) continue

      const senderId = event.sender.id
      const messageText = event.message.text
      const mid = event.message.mid

      // 1. Resolve org + automation from meta_channels
      const { data: metaChannel } = await supabase
        .from('meta_channels')
        .select('org_id, automation_id, config')
        .eq('page_id', pageId)
        .eq('channel_type', channelType)
        .eq('is_active', true)
        .maybeSingle()

      if (!metaChannel) {
        console.warn('[meta/webhook] No active channel for page_id:', pageId, 'type:', channelType)
        continue
      }

      const { org_id: orgId, automation_id: automationId, config } = metaChannel

      // 2. De-duplicate or create conversation
      const channelMetadataFilter = channelType === 'instagram'
        ? { igsid: senderId, page_id: pageId }
        : { sender_id: senderId, page_id: pageId }

      const igsidOrSenderId = channelType === 'instagram' ? 'igsid' : 'sender_id'

      const { data: existing } = await supabase
        .from('conversations')
        .select('id, channel_metadata, last_inbound_at')
        .eq('org_id', orgId)
        .eq('channel', channelType)
        .eq(`channel_metadata->>${igsidOrSenderId}`, senderId)
        .eq('channel_metadata->>page_id', pageId)
        .limit(1)
        .maybeSingle()

      let conversationId: string
      const now = new Date().toISOString()

      if (existing) {
        conversationId = existing.id
        await supabase
          .from('conversations')
          .update({ last_message: messageText, last_message_at: now, last_inbound_at: now, updated_at: now })
          .eq('id', conversationId)
      } else {
        const { data: created } = await supabase
          .from('conversations')
          .insert({
            org_id: orgId,
            widget_token: '',  // not used for Meta channels
            channel: channelType,
            channel_metadata: channelMetadataFilter,
            last_message: messageText,
            last_message_at: now,
            last_inbound_at: now,
          })
          .select('id')
          .single()
        conversationId = created!.id
      }

      // 3. Insert message
      await supabase.from('conversation_messages').insert({
        conversation_id: conversationId,
        org_id: orgId,
        role: 'user',
        content: messageText,
      })

      // 4. 24h window check
      const lastInboundAt = existing?.last_inbound_at ? new Date(existing.last_inbound_at) : null
      const windowExpired = lastInboundAt
        ? (Date.now() - lastInboundAt.getTime()) > 24 * 60 * 60 * 1000
        : false

      if (windowExpired) {
        console.log('[meta/webhook] 24h window expired for conversation:', conversationId)
        await supabase
          .from('conversations')
          .update({ channel_metadata: { ...((existing?.channel_metadata as object) ?? {}), window_expired: 'true' } })
          .eq('id', conversationId)
        continue
      }

      // 5. Keyword trigger check
      if (!automationId) continue

      const keyword = (config as Record<string, string>)?.keyword_trigger ?? null
      if (keyword && !messageText.toLowerCase().includes(keyword.toLowerCase())) continue

      // 6. Fire automation
      try {
        const { data: toolConfig } = await supabase
          .from('tool_configs')
          .select('*, integrations!inner(*)')
          .eq('id', automationId)
          .single()

        if (!toolConfig) continue

        const apiKey = await decrypt((toolConfig as any).integrations.encrypted_api_key)
        const result = await executeAction(
          (toolConfig as any).action_type,
          { message: messageText, conversation_id: conversationId },
          { apiKey, locationId: (toolConfig as any).integrations.location_id ?? '' },
          { organizationId: orgId, supabase }
        )

        // Persist automation response as assistant message
        await supabase.from('conversation_messages').insert({
          conversation_id: conversationId,
          org_id: orgId,
          role: 'assistant',
          content: result,
        })
      } catch (err) {
        console.error('[meta/webhook] Automation dispatch error:', err)
      }
    }
  }
}
```

### Migration 022: `last_inbound_at` + `meta_channels.config`

```sql
-- supabase/migrations/022_conversation_inbound_at.sql
-- Adds last_inbound_at to conversations for 24h Meta messaging window enforcement
-- Adds config JSONB to meta_channels for keyword_trigger and future per-channel settings

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

ALTER TABLE public.meta_channels
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';

-- Index for finding conversations needing 24h window check
CREATE INDEX IF NOT EXISTS idx_conversations_last_inbound_at
  ON public.conversations(last_inbound_at)
  WHERE channel != 'widget';
```

### widget_token Handling for Meta Conversations

The `conversations.widget_token` column is `NOT NULL` (from migration 011) and has no DEFAULT. Meta conversations do not use widget tokens. The insert must provide a value — use an empty string `''` or the org's `widget_token`. Checking migration 011 for the NOT NULL constraint is critical before attempting an insert.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `unstable_after()` | `after()` (stable) | Next.js 15.1.0 | Import from `next/server`, no prefix needed |
| Separate IG and Messenger endpoints | Single unified endpoint | Meta platform policy | One subscription, one handler, `object` field discriminates |
| Meta message tags for extended window | Only `HUMAN_AGENT` tag valid | February 9, 2026 | All other tags deprecated; system must enforce 24h strictly |

**Deprecated/outdated:**
- All Meta Message Tags except `HUMAN_AGENT`: deprecated 2026-02-09. Never use `MESSAGE_TAG` for automated replies. Phase 11 blocks automation after 24h — correct.
- `unstable_after`: renamed to `after()` in Next.js 15.1.0. Use `after` not `unstable_after`.

---

## Open Questions

1. **`widget_token` NOT NULL constraint on conversations**
   - What we know: The `conversations` table requires `widget_token NOT NULL` (migration 011). Meta conversations have no widget token.
   - What's unclear: Whether the column has a database-level DEFAULT or must be provided on every insert.
   - Recommendation: Check migration 011 carefully before writing the insert. Use `''` (empty string) as the widget_token for Meta conversations. If the column truly has no DEFAULT, the insert statement must include `widget_token: ''`.

2. **`tool_configs` query by automation_id UUID**
   - What we know: `meta_channels.automation_id` is a UUID FK to `tool_configs.id`. The existing `resolveTool()` function queries by `org_id + tool_name`, which is the Vapi pattern.
   - What's unclear: Whether the webhook should use `resolveTool()` or query `tool_configs` directly by ID.
   - Recommendation: Query `tool_configs` directly by `id` (the FK value). Do not use `resolveTool()` — it's designed for the Vapi tool-name lookup pattern.

3. **Meta echo messages (message echoes from the page itself)**
   - What we know: Meta sends `messaging[].message.is_echo = true` for messages sent BY the page. These must be filtered out or they create self-referential loops.
   - What's unclear: Whether current Phase 11 scope needs to handle echoes explicitly.
   - Recommendation: Add a check `if (event.message?.is_echo) continue` inside the messaging loop. This prevents echo messages from creating duplicate assistant messages in the inbox.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/meta-webhook.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| METAEV-01 | GET returns challenge when verify token matches | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-01 | GET returns 403 when verify token mismatches | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-01 | POST returns 403 when HMAC signature invalid | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-01 | POST returns 200 when HMAC signature valid | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-02 | Instagram DM creates conversation with channel='instagram' | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-02 | Messenger message creates conversation with channel='messenger' | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-02 | Second message from same sender appends to existing conversation | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-03 | Automation fires when automation_id is set and no keyword filter | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-03 | No automation fires when automation_id is null | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-04 | Automation fires when message contains keyword | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-04 | Automation blocked when message does not contain keyword | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-05 | Automation blocked when last_inbound_at > 24h ago | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-05 | window_expired flag set in channel_metadata after 24h block | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |
| METAEV-05 | Automation fires when last_inbound_at < 24h ago | unit | `npx vitest run tests/meta-webhook.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/meta-webhook.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/meta-webhook.test.ts` — covers all METAEV-01 through METAEV-05 behaviors listed above
- [ ] `tests/meta-process-event.test.ts` (optional alternative split) — unit tests for `processMetaEvent` pure function

*(No framework install needed — Vitest 4.1.2 already installed and configured)*

---

## Project Constraints (from CLAUDE.md)

- `export const runtime = 'nodejs'` required on all webhook route handlers
- Always return HTTP 200 to external webhooks (never let Meta trigger retry storms)
- Use `createServiceRoleClient()` from `src/lib/supabase/admin.ts` — never construct service role client inline
- Use `getUser()` and `createClient()` from `@/lib/supabase/server` for authenticated routes — NOT applicable here (webhook has no user auth context)
- Forms use `react-hook-form` + `zod` — NOT applicable (no UI in this phase)
- `npm run build` must pass after all changes
- `supabase/migrations/` — never edit old migrations; add new ones only
- `src/lib/crypto.ts` — do not change the encryption format (only use `decrypt()` export, never reimplement)

---

## Sources

### Primary (HIGH confidence)
- Next.js 16.2.2 official docs — `after()` API reference: https://nextjs.org/docs/app/api-reference/functions/after (confirmed `after` is exported from `next/server`, confirmed stable since 15.1.0)
- Installed package verification — `node_modules/next` version 16.2.2 with `after` exported as function
- Meta Webhook documentation — Instagram Messaging Webhook (verified via WebFetch 2026-05-04): https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook/
- Meta Webhook payload — Messenger format (verified via WebFetch + community guide 2026): https://messengerbot.app/facebook-messenger-webhook-setup-2026-developer-guide-for-receiving-and-responding-to-messages/
- Project source code — `src/app/api/vapi/tools/route.ts` (live `after()` usage pattern), `src/lib/action-engine/execute-action.ts`, `src/lib/supabase/admin.ts`, all migration files

### Secondary (MEDIUM confidence)
- Meta Webhooks for Messenger Platform: https://developers.facebook.com/docs/messenger-platform/webhooks (navigation confirmed; payload verified via secondary source)
- HMAC-SHA256 verification pattern: Meta Community Forums + hookdeck guide (cross-referenced with Node.js crypto docs)

### Tertiary (LOW confidence)
- None — all critical claims are HIGH or MEDIUM confidence

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified via installed packages and source code
- Architecture patterns: HIGH — webhook patterns confirmed in existing `/api/vapi/tools/route.ts`; Meta payload confirmed via official docs
- Schema gaps: HIGH — directly verified by reading migration files and database types
- Pitfalls: MEDIUM — primarily from code analysis + Meta documentation cross-referencing

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (Meta API policy changes are the main risk; `after()` is stable)

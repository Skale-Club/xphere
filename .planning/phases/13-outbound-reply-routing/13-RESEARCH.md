# Phase 13: Outbound Reply Routing - Research

**Researched:** 2026-05-04
**Domain:** Next.js API Route modification + Meta Graph API Send + AES-256-GCM token decryption
**Confidence:** HIGH (all findings from direct source-code inspection, no guesswork)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Modify the existing `POST /api/chat/conversations/[id]/messages` handler in
  `src/app/api/chat/conversations/[id]/messages/route.ts`. Branch on `conversation.channel` using
  a switch/if-else. No new route files.
- **D-02:** Existing widget path is unchanged — DB insert + update last_message, no outbound API
  call. Zero risk of regression.
- **D-03:** Create `src/lib/meta/send-message.ts` with a single exported async function:
  `sendMetaMessage(pageToken: string, recipientId: string, text: string): Promise<{ messageId: string } | { error: string; code?: number }>`
  Uses the Meta Graph API: `POST https://graph.facebook.com/v21.0/me/messages` with
  `Authorization: Bearer {pageToken}`.
- **D-04:** `src/lib/meta/send-message.ts` is the sole place that calls the Meta Send API —
  isolated for testing with `vi.mock`.
- **D-05:** Extend the POST handler SELECT on conversations to include `channel` and
  `channel_metadata` (currently only fetches `id, org_id`).
- **D-06:** Query `meta_channels` by `page_id + org_id` using `createClient()` (user-scoped);
  RLS scopes to the org automatically.
- **D-07:** Decrypt `meta_channels.encrypted_page_access_token` using `decrypt()` from
  `@/lib/crypto`.
- **D-08:** `recipientId` determination:
  - `channel = 'instagram'` → `channel_metadata.igsid`
  - `channel = 'messenger'` → `channel_metadata.sender_id`
- **D-09:** DB-first: insert message to `conversation_messages` FIRST, then call
  `sendMetaMessage`. Never roll back the DB insert.
- **D-10:** If DB insert fails → return existing 500. If Meta send fails → return structured error
  (D-11). Never roll back DB insert.
- **D-11:** Error classification:
  - Error code 190 → `Response.json({ error: 'token_revoked', channel }, { status: 400 })`
  - Other Meta errors → `Response.json({ error: 'meta_send_failed', message }, { status: 502 })`
  - Missing meta_channels record → `Response.json({ error: 'channel_not_configured' }, { status: 400 })`
- **D-12:** Phase 12 already wired error display in `ChatArea` — Phase 13 just returns the right
  status codes and error shapes.

### Claude's Discretion

- Whether to use `after()` for the Meta send (recommendation: NO — admin is waiting for
  confirmation, synchronous is correct)
- Timeout for Meta API call (recommendation: 10s with AbortController)
- Exact TypeScript type cast for `channel_metadata` JSON field

### Deferred Ideas (OUT OF SCOPE)

- HUMAN_AGENT tag for replies after 24h window
- Read receipt passthrough from Meta webhook
- Retry logic for transient Meta API failures
- WhatsApp Send API
- Optimistic DB rollback on Meta failure
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| METAINBOX-03 | Manual admin replies are sent via the conversation's origin channel (Instagram → IG API, Messenger → Messenger API, widget → existing path) | Route modification pattern confirmed; Meta Send API format verified; token retrieval chain verified; error codes documented |
</phase_requirements>

---

## Summary

Phase 13 modifies exactly one existing file (`src/app/api/chat/conversations/[id]/messages/route.ts`) and creates one new library (`src/lib/meta/send-message.ts`). The existing POST handler fetches only `id, org_id` from conversations — it does NOT yet include `channel` or `channel_metadata`. These must be added to the SELECT on line 102. All downstream DB schema, types, token encryption/decryption, and Meta API version constants are already in place from Phases 10-12.

The channel_metadata field names set by Phase 11 (`process-event.ts`) are authoritative: instagram uses `{ igsid, page_id }` and messenger uses `{ sender_id, page_id }`. Note that migration 020's comment text incorrectly says `psid` for messenger — the actual implementation uses `sender_id`. Trust the code (`process-event.ts`) over the SQL comment.

The `meta_channels` table has RLS (`org_isolation` policy using `get_current_org_id()`), and the POST handler already uses `createClient()` (user-scoped), so no special service-role escalation is needed for the meta_channels lookup.

**Primary recommendation:** The implementation is a mechanical branch — extend the SELECT, add a switch on `channel`, call `sendMetaMessage` after DB insert for non-widget channels, surface structured errors. The only design judgment is the 10s AbortController timeout and the TypeScript cast for `channel_metadata`.

---

## Standard Stack

### Core (already installed — no new dependencies)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| Next.js App Router | 15.x | API route file to modify | Already in use |
| `@/lib/crypto` | project | AES-256-GCM decrypt for page token | Web Crypto API only, no node:crypto |
| `@/lib/meta/oauth.ts` | project | `META_GRAPH_VERSION = 'v21.0'` constant | Reuse, do not hardcode |
| `@/lib/supabase/server` | project | `createClient()` + `getUser()` | Already imported in route |

### No new npm packages needed

All required functionality (fetch, AbortController, Web Crypto) is available in the Node.js runtime already used by this route (`export const runtime = 'nodejs'`).

---

## Architecture Patterns

### Recommended File Structure for This Phase
```
src/
  app/api/chat/conversations/[id]/messages/
    route.ts           # MODIFY — extend SELECT, add channel branch
  lib/meta/
    send-message.ts    # CREATE — sole caller of Meta Send API
tests/
  outbound-reply-routing.test.ts   # CREATE — RED stubs for METAINBOX-03
```

### Pattern 1: Extended SELECT on conversations

The current POST handler (line 100-106 of route.ts):
```typescript
// CURRENT (only id, org_id)
const { data: conv } = await supabase
  .from('conversations')
  .select('id, org_id')
  .eq('id', id)
  .single()
```

Must become:
```typescript
// REQUIRED (add channel, channel_metadata)
const { data: conv } = await supabase
  .from('conversations')
  .select('id, org_id, channel, channel_metadata')
  .eq('id', id)
  .single()
```

The TypeScript type for `conv` after this change is:
- `channel`: `string` (values: `'widget' | 'messenger' | 'instagram'`)
- `channel_metadata`: `Json` from `database.ts` — must be cast as
  `Record<string, string>` when extracting `igsid`/`sender_id`/`page_id`

### Pattern 2: sendMetaMessage lib (D-03 spec)

```typescript
// src/lib/meta/send-message.ts
import { META_GRAPH_VERSION } from '@/lib/meta/oauth'

type SendSuccess = { messageId: string }
type SendError   = { error: string; code?: number }

export async function sendMetaMessage(
  pageToken: string,
  recipientId: string,
  text: string
): Promise<SendSuccess | SendError> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${pageToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    })

    const json = await res.json() as { message_id?: string; error?: { message?: string; code?: number } }

    if (!res.ok) {
      return { error: json.error?.message ?? 'Meta API error', code: json.error?.code }
    }

    return { messageId: json.message_id ?? '' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'Meta API timeout', code: undefined }
    }
    return { error: String(err) }
  } finally {
    clearTimeout(timeout)
  }
}
```

### Pattern 3: Token retrieval from meta_channels

```typescript
// Inside POST handler, after DB insert succeeds, for non-widget channels:
const metadata = conv.channel_metadata as Record<string, string>
const pageId = metadata.page_id

const { data: metaChannel } = await supabase
  .from('meta_channels')
  .select('encrypted_page_access_token')
  .eq('page_id', pageId)
  .eq('channel_type', conv.channel)   // 'instagram' | 'messenger'
  .eq('is_active', true)
  .maybeSingle()

if (!metaChannel) {
  return Response.json({ error: 'channel_not_configured' }, { status: 400 })
}

const pageToken = await decrypt(metaChannel.encrypted_page_access_token)
```

Note: `channel_type` in `meta_channels` matches the conversation `channel` value exactly for
`'instagram'` and `'messenger'`. No mapping needed.

### Pattern 4: recipientId extraction

```typescript
const recipientId =
  conv.channel === 'instagram'
    ? (metadata.igsid ?? '')
    : (metadata.sender_id ?? '')  // messenger
```

Source: `process-event.ts` lines 94-96 (instagram) and lines 95-96 alt (messenger), confirmed by
`meta-webhook-conversation.test.ts` assertions.

### Pattern 5: Error classification

```typescript
const result = await sendMetaMessage(pageToken, recipientId, content)

if ('error' in result) {
  if (result.code === 190) {
    return Response.json(
      { error: 'token_revoked', channel: conv.channel },
      { status: 400 }
    )
  }
  return Response.json(
    { error: 'meta_send_failed', message: result.error },
    { status: 502 }
  )
}
// success — fall through to existing Response.json({ message }, { status: 201 })
```

### Anti-Patterns to Avoid

- **Do NOT use `after()`** for the Meta send call. The admin reply is synchronous from the user's
  perspective — they need confirmation the message was delivered or an error to act on.
- **Do NOT add `createServiceRoleClient()`** — the route already uses `createClient()` which RLS
  scopes to the org. Adding service role would bypass RLS unnecessarily.
- **Do NOT touch the widget path** — the existing DB insert + `last_message` update must pass
  through untouched.
- **Do NOT hardcode `'v21.0'`** — import `META_GRAPH_VERSION` from `@/lib/meta/oauth.ts`.
- **Do NOT use `node:crypto`** — `src/lib/crypto.ts` explicitly uses Web Crypto API only (the
  comment on line 3 says "NEVER import from 'node:crypto'"). The decrypt function is already
  Web Crypto safe.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AES-256-GCM decrypt | Custom decryption | `decrypt()` from `@/lib/crypto` | Already handles IV+ciphertext split, Web Crypto, key validation |
| Meta API URL version | Hardcode `v21.0` | `META_GRAPH_VERSION` from `@/lib/meta/oauth` | Single source of truth, used by all Meta OAuth flows |
| Supabase client creation | New client patterns | `createClient()` already imported in route | Cached, RLS-scoped, matches existing pattern |
| Meta error parsing | Custom JSON parse | Parse `res.json()` in sendMetaMessage only | Isolated in lib, mockable via `vi.mock` |

---

## Critical Discrepancy: Migration Comment vs. Implementation

**Migration 020 comment says:** `messenger: { "page_id": "...", "psid": "..." }`
**process-event.ts line 95 actually sets:** `{ sender_id: senderId, page_id: pageId }`
**meta-webhook-conversation.test.ts line 201 asserts:** `channel_metadata: { sender_id: 'psid-321', page_id: 'page-789' }`

**Conclusion:** The field name for messenger is `sender_id`, not `psid`. CONTEXT.md D-08 is correct.
The SQL migration comment is stale and should be ignored. The planner must document this discrepancy
and instruct the implementer to use `sender_id` as confirmed by both the source code and tests.

---

## Current POST Handler Analysis (Highest Risk File)

File: `src/app/api/chat/conversations/[id]/messages/route.ts`

**Line-by-line map of what exists:**

| Lines | What it does | Change needed? |
|-------|-------------|----------------|
| 1-7 | Imports: `createClient`, `getUser`, `z`, `ConversationMessage` | Add `decrypt` + `sendMetaMessage` imports |
| 9 | `export const runtime = 'nodejs'` | None — already Node.js |
| 84-87 | `SendMessageSchema`: content (string min 1) + role (literal 'assistant') | None |
| 89-151 | POST handler | Modify |
| 100-106 | `SELECT 'id, org_id'` from conversations | Extend to include `channel, channel_metadata` |
| 109-127 | Body parse + DB insert into conversation_messages | None — DB insert stays first (D-09) |
| 131-139 | Update conversation last_message/last_message_at | None — widget and Meta both need this |
| 141-151 | Return `{ message }` with status 201 | No change for widget; for Meta, intercept before return if sendMetaMessage fails |

**Widget path preservation:** The new channel branch executes AFTER the DB insert and `last_message`
update. The `return Response.json({ message }, { status: 201 })` at line 151 becomes the success
return for ALL channels (including Meta), with error early-returns for Meta failures only.

---

## Common Pitfalls

### Pitfall 1: Modifying the Widget Path
**What goes wrong:** Adding channel logic before or around the DB insert accidentally changes
behavior for widget conversations.
**Why it happens:** The switch/if-else is placed at the wrong position relative to shared logic.
**How to avoid:** Insert the channel branch AFTER line 139 (after `last_message` update). Widget
returns at line 151 unchanged. Meta channels call `sendMetaMessage` between line 139 and 151.
**Warning signs:** Tests for widget path return unexpected status codes.

### Pitfall 2: Using `psid` instead of `sender_id`
**What goes wrong:** Messenger messages sent to wrong recipient ID or field lookup returns undefined.
**Why it happens:** Migration 020 SQL comment says `psid`; actual code uses `sender_id`.
**How to avoid:** Use `metadata.sender_id` not `metadata.psid`. Verified in process-event.ts line 95.

### Pitfall 3: TypeScript Strict Mode + `channel_metadata` as `Json`
**What goes wrong:** `conv.channel_metadata` is typed as `Json` (a recursive union from database.ts).
Direct property access like `conv.channel_metadata.igsid` fails TypeScript strict mode.
**Why it happens:** `Json` type doesn't have string-index signature.
**How to avoid:** Cast explicitly: `const metadata = conv.channel_metadata as Record<string, string>`
then use `metadata.igsid`, `metadata.sender_id`, `metadata.page_id`.

### Pitfall 4: Not Checking for Missing meta_channels Record
**What goes wrong:** If `maybeSingle()` returns `null` (no active meta_channel for this page),
`decrypt()` is called on `undefined.encrypted_page_access_token` → runtime crash.
**How to avoid:** Check `if (!metaChannel)` before decrypt and return `{ error: 'channel_not_configured' }`.

### Pitfall 5: Synchronous Send Blocking the Route Beyond Timeout
**What goes wrong:** Meta API call hangs; Vercel Hobby has a 10s default function timeout.
**Why it happens:** No AbortController on the fetch.
**How to avoid:** Use `AbortController` with 10s timeout in `sendMetaMessage`.

### Pitfall 6: DB State Inconsistency on Meta Failure
**What goes wrong:** Message is saved to DB but Meta send fails — admin sees the message as sent
but recipient never received it.
**Why it happens:** D-09 mandates DB-first; D-10 says never roll back.
**How to handle:** This is intentional. The structured error (D-11) surfaces in the UI so the admin
knows the message was stored but delivery failed. Do not attempt rollback — it's a known trade-off.

---

## Code Examples

### How process-event.ts sets channel_metadata (verified source truth)
```typescript
// Source: src/lib/meta/process-event.ts lines 93-97
const channelMetadata =
  channelType === 'instagram'
    ? { igsid: senderId, page_id: pageId }
    : { sender_id: senderId, page_id: pageId }
```

### How meta_channels is queried in process-event.ts (pattern to replicate)
```typescript
// Source: src/lib/meta/process-event.ts lines 47-52
const { data: metaChannel } = await supabase
  .from('meta_channels')
  .select('org_id, automation_id, config')
  .eq('page_id', pageId)
  .eq('channel_type', channelType)
  .eq('is_active', true)
  .maybeSingle()
```

### How decrypt is called in process-event.ts (pattern to replicate)
```typescript
// Source: src/lib/meta/process-event.ts line 177
const plaintextKey = await decrypt(integration.encrypted_api_key)
// For Phase 13 — same pattern:
const pageToken = await decrypt(metaChannel.encrypted_page_access_token)
```

### Meta Send API verified shape (from CONTEXT.md + oauth.ts patterns)
```typescript
// Endpoint: POST https://graph.facebook.com/v21.0/me/messages
// Headers: Authorization: Bearer {pageToken}, Content-Type: application/json
// Body:
{
  recipient: { id: recipientId },
  message: { text: content },
  messaging_type: 'RESPONSE'
}
// Success response shape: { message_id: string, recipient_id: string }
// Error response shape:   { error: { message: string, type: string, code: number, fbtrace_id: string } }
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run tests/outbound-reply-routing.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| METAINBOX-03 | Widget reply: DB insert only, no Meta call, returns 201 | unit | `npx vitest run tests/outbound-reply-routing.test.ts` | ❌ Wave 0 |
| METAINBOX-03 | Instagram reply: calls sendMetaMessage with igsid as recipientId | unit | `npx vitest run tests/outbound-reply-routing.test.ts` | ❌ Wave 0 |
| METAINBOX-03 | Messenger reply: calls sendMetaMessage with sender_id as recipientId | unit | `npx vitest run tests/outbound-reply-routing.test.ts` | ❌ Wave 0 |
| METAINBOX-03 | Meta error code 190 → 400 with `{ error: 'token_revoked', channel }` | unit | `npx vitest run tests/outbound-reply-routing.test.ts` | ❌ Wave 0 |
| METAINBOX-03 | Other Meta error → 502 with `{ error: 'meta_send_failed', message }` | unit | `npx vitest run tests/outbound-reply-routing.test.ts` | ❌ Wave 0 |
| METAINBOX-03 | Missing meta_channels record → 400 with `{ error: 'channel_not_configured' }` | unit | `npx vitest run tests/outbound-reply-routing.test.ts` | ❌ Wave 0 |
| METAINBOX-03 | Unauthenticated user → 401 | unit | `npx vitest run tests/outbound-reply-routing.test.ts` | ❌ Wave 0 |
| METAINBOX-03 | DB insert fails → 500, no Meta call attempted | unit | `npx vitest run tests/outbound-reply-routing.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/outbound-reply-routing.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/outbound-reply-routing.test.ts` — covers all METAINBOX-03 behaviors (RED stubs)

### Test Mock Strategy (from Phase 12 pattern)

The route imports `createClient` and `getUser` from `@/lib/supabase/server`. Tests must:

```typescript
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('@/lib/meta/send-message', () => ({
  sendMetaMessage: vi.fn(),
}))
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue('decrypted-page-token'),
}))
```

The mock Supabase client must support the chained query pattern the route uses. See
`tests/meta-webhook-conversation.test.ts` `buildMockSupabase()` and
`tests/meta-inbox-bot-toggle.test.ts` for the established pattern in this codebase.

Use `vi.resetModules()` in `beforeEach` (as in meta-webhook tests) to ensure dynamic import of
the route picks up fresh mocks.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies beyond the project's own code — `sendMetaMessage`
calls Meta API but this is mocked in all tests; no CLI tools or services needed to build).

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 13 |
|-----------|-------------------|
| Always use `createClient()` + `getUser()` from `@/lib/supabase/server`, never raw `supabase.auth.getUser()` | Route already compliant; maintain this |
| `export const runtime = 'nodejs'` on API routes | Already set on messages/route.ts |
| Run `npm run build` after changes to catch type errors | Mandatory gate before marking tasks complete |
| Never edit old migrations; add new ones | No migrations needed for Phase 13 |
| `src/lib/crypto.ts` — do not change encryption format | Phase 13 only calls `decrypt()`, never touches the format |
| Forms use `react-hook-form` + `zod` + `zodResolver` | Not applicable (no UI changes) |
| Vapi webhooks always return HTTP 200 | Not applicable (this is the admin messages route, not a Vapi webhook) |
| TypeScript strict mode | `channel_metadata` must be cast explicitly (see Pitfall 3) |

---

## Sources

### Primary (HIGH confidence)
- `src/app/api/chat/conversations/[id]/messages/route.ts` — exact current handler, read in full
- `src/lib/meta/process-event.ts` — authoritative source for channel_metadata field names
- `src/lib/meta/oauth.ts` — META_GRAPH_VERSION, Meta API fetch patterns
- `src/lib/crypto.ts` — decrypt() signature and constraints
- `supabase/migrations/019_meta_channels.sql` — meta_channels schema
- `supabase/migrations/020_conversations_channel.sql` — conversations channel + channel_metadata schema
- `supabase/migrations/022_conversation_inbound_at.sql` — confirms meta_channels.config column exists
- `src/types/database.ts` — TypeScript types for all tables
- `src/types/chat.ts` — ConversationSummary shape
- `tests/meta-webhook-conversation.test.ts` — confirms `sender_id` (not `psid`) for messenger

### Secondary (MEDIUM confidence)
- CONTEXT.md — implementation decisions
- STATE.md — confirms this is the highest-risk change in v1.3

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already present, no new installs
- Architecture patterns: HIGH — verified directly from source code
- Pitfalls: HIGH — TypeScript strict mode and field name discrepancy verified from actual files
- Meta Send API format: HIGH — confirmed in CONTEXT.md specifics section, consistent with oauth.ts patterns

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (Meta API v21.0 is stable; internal code is static)

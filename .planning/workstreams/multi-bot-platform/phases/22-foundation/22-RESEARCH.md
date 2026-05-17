# Phase 22: Foundation - Research

**Researched:** 2026-05-06
**Domain:** Supabase migrations · Node.js webhook handler · Server actions · TypeScript types
**Confidence:** HIGH — all findings come from direct codebase inspection of files in this repo

---

## Summary

Phase 22 is entirely a backend/data layer phase. It has zero UI work. The goal is three deliverables: (1) a Supabase migration that adds `manychat_channels`, `manychat_events`, and extends the `integration_provider` enum with `manychat`; (2) a Node.js webhook route at `/api/manychat/webhook` with `X-Operator-Secret` verification; and (3) server actions for channel CRUD (create/delete, with encrypted API key and auto-generated webhook secret).

Every pattern needed already exists in the codebase with high-fidelity examples. Encryption uses `encrypt()`/`decrypt()`/`maskApiKey()` from `src/lib/crypto.ts`. Webhook secret generation uses `crypto.randomUUID()` (same as `widget_token` regen and OAuth state). Service-role Supabase client is `createServiceRoleClient()` from `src/lib/supabase/admin.ts`. The next migration number is **026**.

The only architectural subtlety is the org-resolution chain in the webhook: there is no user session — the handler must use the service-role client to look up `manychat_channels` by `webhook_secret` to find `org_id`, then insert into `manychat_events`. This is the same pattern used by the Vapi calls handler (resolves org via `assistant_mappings`).

**Primary recommendation:** Follow `meta_channels` migration as the SQL template, the Meta webhook route as the handler template, and `integrations/actions.ts` as the server actions template. No new dependencies required.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHANNEL-01 | Admin can connect a ManyChat account by entering an API key (stored encrypted via AES-256-GCM) | `encrypt()` + `maskApiKey()` from `src/lib/crypto.ts`; server action pattern from `integrations/actions.ts` |
| CHANNEL-05 | Admin can disconnect (delete) a ManyChat channel | `deleteIntegration()` pattern from `integrations/actions.ts`; `supabase.from('manychat_channels').delete().eq('id', id)` |
| WEBHOOK-01 | POST /api/manychat/webhook receives External Request events from ManyChat flows | Node.js route handler; `createServiceRoleClient()` for service-role DB access |
| WEBHOOK-02 | Requests with invalid or missing X-Operator-Secret header are rejected with HTTP 403 | Secret comparison via `timingSafeEqual`; lookup by `webhook_secret` in `manychat_channels` |
| WEBHOOK-03 | All inbound events are logged to `manychat_events` with status: matched, unmatched, or error | Phase 22 always writes `status: 'unmatched'`; routing wired in Phase 23 |
| WEBHOOK-04 | Webhook always returns HTTP 200 after secret validation (prevents ManyChat retry storms) | Same pattern as Meta webhook and Vapi calls handler |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | Already installed | Service-role DB writes from webhook handler | Used by all other webhook handlers |
| `src/lib/crypto.ts` | In-repo | AES-256-GCM encrypt/decrypt/mask | Sole encryption module — never hand-roll |
| `src/lib/supabase/admin.ts` | In-repo | `createServiceRoleClient()` for webhook handlers | All webhook handlers use this pattern |
| `src/lib/supabase/server.ts` | In-repo | `createClient()` + `getUser()` for server actions | All dashboard server actions use this |
| `node:crypto` | Node.js built-in | `timingSafeEqual` for constant-time secret comparison | Used by `src/lib/vapi/verify-signature.ts` |
| `next/cache` | Already installed | `revalidatePath()` in server actions | Standard for invalidating route cache |

### No New Dependencies
This phase requires zero new npm packages. Everything is already in the project.

---

## Architecture Patterns

### Recommended File Structure (Phase 22 additions)
```
supabase/migrations/
  026_manychat_foundation.sql     # new tables + enum extension
src/
  app/api/manychat/webhook/
    route.ts                      # POST handler + secret verification
  app/(dashboard)/integrations/manychat/
    actions.ts                    # server actions: createManychatChannel, deleteManychatChannel
  types/database.ts               # add ManychatChannel + ManychatEvent rows (manual edit)
```

### Pattern 1: Migration Structure (model: 019_meta_channels.sql)

The `manychat_channels` table follows the `meta_channels` pattern:
- `org_id` FK with `UNIQUE(org_id)` — one per org
- `encrypted_api_key` TEXT — AES-256-GCM format `iv:ciphertext`
- `key_hint` TEXT — `••••••••last4`
- `webhook_secret` TEXT — plaintext random UUID stored as-is
- `is_active` BOOLEAN DEFAULT true
- `config` JSONB DEFAULT '{}'
- `updated_at` trigger via existing `update_updated_at()` function
- RLS: `org_isolation` policy FOR ALL TO authenticated USING/WITH CHECK `org_id = public.get_current_org_id()`

The `manychat_events` table is append-only:
- No UPDATE or DELETE RLS policies (INSERT + SELECT only for authenticated users)
- Service role used from webhook handler — bypasses RLS entirely for inserts
- `status` field: `TEXT CHECK (status IN ('matched', 'unmatched', 'error'))`
- `event_payload` JSONB — raw body stored as-is

Enum extension (same pattern as `006_api_key_admin.sql`):
```sql
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'manychat';
```

**IMPORTANT:** PostgreSQL enum `ADD VALUE` cannot run inside a transaction block. In Supabase migrations this is safe because each migration file runs as its own transaction. No workaround needed.

### Pattern 2: Webhook Handler (model: src/app/api/meta/webhook/route.ts)

```typescript
// src/app/api/manychat/webhook/route.ts
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const secret = request.headers.get('x-operator-secret')
    // 1. Look up channel by webhook_secret (service role — no user session)
    const supabase = createServiceRoleClient()
    const { data: channel } = await supabase
      .from('manychat_channels')
      .select('id, org_id')
      .eq('webhook_secret', secret ?? '')
      .eq('is_active', true)
      .maybeSingle()

    if (!channel) {
      return new Response(null, { status: 403 })
    }

    // 2. Parse body
    let body: unknown
    try { body = await request.json() } catch { body = {} }

    // 3. Log event — always unmatched at this phase
    await supabase.from('manychat_events').insert({
      org_id: channel.org_id,
      channel_id: channel.id,
      event_type: (body as Record<string, string>)?.event_type ?? 'unknown',
      event_payload: body as Json,
      status: 'unmatched',
    })

    return Response.json({ ok: true })
  } catch {
    // Never expose errors — always 200 after secret validation would have passed
    return Response.json({ ok: true })
  }
}
```

Key differences from Meta webhook:
- No HMAC — secret is a simple string equality check (via lookup, not env var)
- No `after()` needed — logging is synchronous and fast (single INSERT)
- 403 is returned BEFORE the always-200 rule kicks in (secret validation is the gate)

### Pattern 3: Secret Generation (model: src/app/(dashboard)/widget/actions.ts)

```typescript
// webhook_secret generation in createManychatChannel server action
const webhookSecret = crypto.randomUUID()
```

`crypto.randomUUID()` is the project standard. It returns a v4 UUID (128 bits of entropy), which is sufficient for a shared secret token. No `randomBytes` import needed — `crypto` is the global Web Crypto API available in all runtimes.

### Pattern 4: Server Actions for Channel CRUD (model: src/app/(dashboard)/integrations/actions.ts)

```typescript
'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encrypt, maskApiKey } from '@/lib/crypto'

export async function createManychatChannel(data: {
  channelName: string
  apiKey: string
}): Promise<{ error?: string; webhookSecret?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const encryptedKey = await encrypt(data.apiKey)
  const webhookSecret = crypto.randomUUID()

  const { error } = await supabase.from('manychat_channels').insert({
    channel_name: data.channelName,
    encrypted_api_key: encryptedKey,
    key_hint: maskApiKey(data.apiKey),
    webhook_secret: webhookSecret,
    is_active: true,
    config: {},
  })

  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
  // Return webhookSecret once so the UI can display it (never stored in plaintext beyond DB)
}

export async function deleteManychatChannel(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase.from('manychat_channels').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
}
```

Note: `org_id` is NOT manually set — RLS + `get_current_org_id()` handles tenant scoping automatically via `WITH CHECK`. The authenticated Supabase client is used for server actions (not service role). The webhook handler uses service role because there is no user session.

### Pattern 5: TypeScript Types (model: src/types/database.ts)

The file is manually maintained. After writing the migration, add to the `Tables` block:

```typescript
manychat_channels: {
  Row: {
    id: string
    org_id: string
    channel_name: string
    encrypted_api_key: string
    key_hint: string | null
    webhook_secret: string
    is_active: boolean
    config: Json
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    org_id?: string  // set by RLS / get_current_org_id()
    channel_name: string
    encrypted_api_key: string
    key_hint?: string | null
    webhook_secret: string
    is_active?: boolean
    config?: Json
    created_at?: string
    updated_at?: string
  }
  Update: {
    channel_name?: string
    encrypted_api_key?: string
    key_hint?: string | null
    webhook_secret?: string
    is_active?: boolean
    config?: Json
    updated_at?: string
  }
  Relationships: [...]
}

manychat_events: {
  Row: {
    id: string
    org_id: string
    channel_id: string
    event_type: string
    event_payload: Json
    matched_rule_id: string | null
    status: 'matched' | 'unmatched' | 'error'
    action_log_id: string | null
    created_at: string
  }
  Insert: {
    id?: string
    org_id: string
    channel_id: string
    event_type: string
    event_payload: Json
    matched_rule_id?: string | null
    status: 'matched' | 'unmatched' | 'error'
    action_log_id?: string | null
    created_at?: string
  }
  Update: Record<string, never>  // append-only
  Relationships: [...]
}
```

Also update the `Enums` block:
```typescript
integration_provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat'
```

### Anti-Patterns to Avoid

- **Using authenticated Supabase client in the webhook handler:** The webhook has no user session. Must use `createServiceRoleClient()` from `src/lib/supabase/admin.ts`, same as `vapi/calls/route.ts`.
- **Trusting `org_id` from request body:** The PLANNING.md explicitly prohibits this. Org must be resolved by looking up `webhook_secret` in `manychat_channels`. Never read org from the payload.
- **Returning HTTP 403 after the secret check passes:** Once `channel` is resolved (secret valid), all responses are 200 — even if JSON parse fails or DB insert fails.
- **Using `Buffer` or `node:crypto.randomBytes` for secret generation:** The project uses `crypto.randomUUID()` (Web Crypto API global) everywhere. Stay consistent.
- **Manually filtering by `org_id` in server actions:** RLS handles it via `get_current_org_id()`. Adding a manual `.eq('org_id', ...)` is redundant but not wrong — just inconsistent with the rest of the codebase.
- **Editing old migrations:** Never. Always add migration 026 as a new file.
- **Returning `encrypted_api_key` from server actions:** Only `key_hint` goes to the UI. The `getManychatChannel()` action (for the UI) must SELECT without `encrypted_api_key`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AES-256-GCM encryption | Custom encrypt/decrypt | `encrypt()`/`decrypt()` from `src/lib/crypto.ts` | Format is `iv:ciphertext` base64; changing it would break existing decryption |
| Constant-time secret comparison | `===` operator | `timingSafeEqual` from `node:crypto` | Timing attacks — same reason `vapi/verify-signature.ts` uses it |
| Service-role Supabase client | Direct `createClient(SUPABASE_SERVICE_ROLE_KEY)` | `createServiceRoleClient()` from `src/lib/supabase/admin.ts` | Centralized pattern; typed with `Database` |
| Secret token generation | Custom UUID/random | `crypto.randomUUID()` | Already the project standard; no extra imports |
| API key masking | Custom mask function | `maskApiKey()` from `src/lib/crypto.ts` | Returns `••••••••last4` format consistently |

---

## Common Pitfalls

### Pitfall 1: org_id resolution in webhook
**What goes wrong:** Developer inserts `manychat_events` using `org_id` from the request body JSON, allowing any caller to spoof tenant identity.
**Why it happens:** Convenient — the ManyChat payload template includes `org_id` or similar data.
**How to avoid:** NEVER read `org_id` from payload. Always resolve via `supabase.from('manychat_channels').select('org_id').eq('webhook_secret', headerValue)`.
**Warning signs:** Any code that does `const orgId = body.org_id`.

### Pitfall 2: PostgreSQL enum ADD VALUE in a transaction
**What goes wrong:** `ALTER TYPE integration_provider ADD VALUE 'manychat'` fails if wrapped in an explicit transaction.
**Why it happens:** PostgreSQL does not allow enum value addition inside a transaction block (pre-PG16 limitation).
**How to avoid:** The migration file should NOT wrap the enum change in `BEGIN/COMMIT`. Supabase runs each migration as a single implicit transaction, but enum `ADD VALUE IF NOT EXISTS` is compatible with this because Supabase uses a special transaction mode for DDL. In practice, the pattern used in `006_api_key_admin.sql` works without issues — follow that exactly.
**Warning signs:** Migration fails with "ERROR: cannot alter type ... inside a transaction block".

### Pitfall 3: Returning 403 after a valid secret resolves
**What goes wrong:** Developer adds error handling that returns 403 or 500 for malformed JSON or DB errors after the secret was already validated.
**Why it happens:** Natural error-handling instinct.
**How to avoid:** The outer `try/catch` must always return 200. Only the secret validation gate returns 403. See Meta webhook pattern.
**Warning signs:** Any `return new Response(null, { status: 403 })` outside the secret check block.

### Pitfall 4: `manychat_events` RLS blocks webhook inserts
**What goes wrong:** The service-role client bypasses RLS, but if the developer accidentally uses the authenticated client in the webhook handler, inserts to `manychat_events` will fail because there is no active session.
**Why it happens:** Importing `createClient` from `@/lib/supabase/server` instead of `createServiceRoleClient` from `@/lib/supabase/admin`.
**How to avoid:** Webhook route handlers always use `createServiceRoleClient()`. Server actions always use `createClient()`.

### Pitfall 5: Updated_at trigger function may not exist on new table
**What goes wrong:** `CREATE TRIGGER ... EXECUTE FUNCTION public.update_updated_at()` fails if the function was not created in an earlier migration.
**Why it happens:** Assumption that the trigger function already exists.
**How to avoid:** Verify — `update_updated_at()` was created in an early migration and is used in `025_tool_folders.sql`. It is safe to use in migration 026 without re-creating it.

---

## Key Facts Extracted from Codebase

### Migration Number
- Last migration: `025_tool_folders.sql`
- Next migration: **`026_manychat_foundation.sql`**

### Enum Current State
**`integration_provider`** current values (from migrations 002 + 006):
- `'gohighlevel'`, `'twilio'`, `'calcom'`, `'custom_webhook'`, `'openai'`, `'anthropic'`, `'openrouter'`, `'vapi'`
- Phase 22 adds: `'manychat'`

**`action_type`** current values (from migration 002 — no additions since):
- `'create_contact'`, `'get_availability'`, `'create_appointment'`, `'send_sms'`, `'knowledge_base'`, `'custom_webhook'`
- Phase 25 will add `manychat_*` values — Phase 22 does NOT touch this enum

### Encryption API (src/lib/crypto.ts)
```typescript
export async function encrypt(plaintext: string): Promise<string>
// Returns: `${ivB64}:${ciphertextB64}`

export async function decrypt(stored: string): Promise<string>
// Input: `${ivB64}:${ciphertextB64}`

export function maskApiKey(apiKey: string): string
// Returns: `••••••••${last4}` (synchronous, no await needed)
```
The `ENCRYPTION_SECRET` env var must be a 64-character hex string (32 bytes). Already configured in production.

### Service Role Client (src/lib/supabase/admin.ts)
```typescript
import { createServiceRoleClient } from '@/lib/supabase/admin'
const supabase = createServiceRoleClient()
```
Uses `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Already configured.

### Webhook Secret Generation
```typescript
const webhookSecret = crypto.randomUUID()  // no import needed — Web Crypto global
```
Confirmed used in `src/app/(dashboard)/widget/actions.ts` (line 116) and `src/app/(dashboard)/integrations/meta/actions.ts` (line 36).

### RLS Policy Pattern (from meta_channels)
```sql
CREATE POLICY "org_isolation" ON public.manychat_channels
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());
```

For `manychat_events` (append-only), two separate policies:
```sql
-- Authenticated users can see their org's events
CREATE POLICY "org_isolation_select" ON public.manychat_events
  FOR SELECT TO authenticated
  USING (org_id = public.get_current_org_id());

-- Authenticated users can insert (but no update/delete)
CREATE POLICY "org_isolation_insert" ON public.manychat_events
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.get_current_org_id());

-- Service role inserts from webhook bypass RLS automatically
```

### Updated_at Trigger (verified in 025_tool_folders.sql)
The function `public.update_updated_at()` exists and is reusable:
```sql
CREATE TRIGGER trg_manychat_channels_updated_at
  BEFORE UPDATE ON public.manychat_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### config JSONB Column Convention
All channel tables use `config JSONB NOT NULL DEFAULT '{}'`. Phase 22 stores this empty — future phases populate it.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 22 is a pure code and database migration phase. No external CLI tools, services, or runtimes beyond the already-configured Vercel + Supabase environment are required. No new environment variables are needed.

Note: `ENCRYPTION_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are already configured in production (used by existing integrations). Migration requires `SUPABASE_DB_PASSWORD` which is separately tracked as a pending todo.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (tests/ directory present) |
| Config file | vitest.config.ts (root) |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| WEBHOOK-02 | Invalid secret returns 403 | unit | manual curl / integration test | No automated test file exists yet for webhook routes |
| WEBHOOK-03 | Valid webhook inserts to manychat_events | unit | manual curl | Requires DB connection |
| WEBHOOK-04 | Valid webhook returns 200 | unit | manual curl | |
| CHANNEL-01 | API key stored encrypted, hint returned | unit | manual inspection | |
| CHANNEL-05 | Delete removes DB row | unit | manual inspection | |

For this foundation phase, manual curl-based verification is the established testing approach (same as meta webhook was verified). No automated DB integration tests exist in the test suite for webhook handlers.

**Manual verification protocol (established pattern):**
```bash
# Valid secret — expect 200 + event in DB
curl -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -H "X-Operator-Secret: <webhook_secret_from_db>" \
  -d '{"event_type":"flow_completed","subscriber_id":"test123"}'

# Invalid secret — expect 403
curl -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -H "X-Operator-Secret: invalid-secret" \
  -d '{}'
```

---

## Open Questions

1. **Should `webhook_secret` use `timingSafeEqual` for comparison?**
   - What we know: The Vapi handler uses `timingSafeEqual` for its secret check. The ManyChat pattern uses a DB lookup (comparing against DB value) rather than an env var — timing attacks are harder to exploit via DB round-trip latency.
   - What's unclear: Whether the security bar requires `timingSafeEqual` for a DB-lookup comparison.
   - Recommendation: Use `timingSafeEqual` anyway for consistency. Extract the secret string from DB and compare with `timingSafeEqual(Buffer.from(dbSecret), Buffer.from(headerSecret))`. This adds minimal complexity and follows the principle of defense-in-depth.

2. **Should `manychat_events` also have a service-role INSERT policy or rely entirely on bypass?**
   - What we know: Service role bypasses RLS entirely. The webhook handler uses service role. Authenticated users (Phase 26 UI) only need SELECT.
   - Recommendation: Give authenticated users SELECT-only policy. No INSERT policy for authenticated is needed since the UI never writes events directly. Service role handles all webhook inserts.

3. **`config` JSONB on `manychat_channels` — what will it store in future phases?**
   - From PLANNING.md: "Future: payload field mappings, default event_type"
   - Phase 22 action: Store as empty `{}`. Document in migration comment what it will hold.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `src/lib/crypto.ts` — exact encrypt/decrypt/maskApiKey API signatures
- `src/lib/supabase/admin.ts` — createServiceRoleClient() pattern
- `src/app/api/meta/webhook/route.ts` — webhook handler structure, error handling, 200/403 decision
- `src/app/api/vapi/calls/route.ts` — service-role client in webhook + org resolution pattern
- `src/lib/vapi/verify-signature.ts` — timingSafeEqual secret comparison
- `src/app/(dashboard)/integrations/actions.ts` — full server actions pattern (encrypt, mask, CRUD)
- `src/app/(dashboard)/widget/actions.ts` — crypto.randomUUID() for secret generation
- `supabase/migrations/002_action_engine.sql` — original enum definitions
- `supabase/migrations/006_api_key_admin.sql` — ALTER TYPE ADD VALUE IF NOT EXISTS pattern
- `supabase/migrations/019_meta_channels.sql` — channel table + RLS template
- `supabase/migrations/025_tool_folders.sql` — update_updated_at() trigger reuse
- `src/types/database.ts` — current type shape to extend

### Secondary (MEDIUM confidence)
- `projects/manychat-integration/PLANNING.md` — data model, API surface, security decisions (authored by project owner)
- `.planning/STATE.md` — locked v1.6 architecture decisions

---

## Metadata

**Confidence breakdown:**
- Migration SQL: HIGH — exact templates exist in this codebase (meta_channels, tool_folders)
- Webhook handler: HIGH — meta webhook and vapi/calls are direct templates
- Server actions: HIGH — integrations/actions.ts is a direct template
- TypeScript types: HIGH — database.ts shape fully documented
- Enum current state: HIGH — read directly from migration files

**Research date:** 2026-05-06
**Valid until:** Indefinite — all findings are from this codebase's own source files, not external documentation

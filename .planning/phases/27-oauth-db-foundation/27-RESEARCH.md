# Phase 27: OAuth + DB Foundation - Research

**Researched:** 2026-05-06
**Domain:** Google OAuth 2.0 authorization code flow, PostgreSQL enum migration, Next.js API routes
**Confidence:** HIGH

## Summary

Phase 27 implements Google OAuth 2.0 per-org credential storage using the existing `integrations` table. The implementation is a near-direct port of the Meta OAuth pattern that already exists in the codebase — the same CSRF cookie flow, the same `encrypt()` call from `src/lib/crypto.ts`, and the same Supabase `upsert` with `onConflict: 'organization_id,provider'`. The primary new work is (1) a PostgreSQL migration extending the `integration_provider` enum with `'google_contacts'`, (2) a Google-specific OAuth utility file, (3) a callback route at `/api/google/callback`, and (4) connect/disconnect server actions.

Google's token endpoint returns both `access_token` and `refresh_token` in a single exchange (when `access_type=offline` is included in the authorization URL). Access tokens expire in ~3600 seconds (1 hour); the refresh token is long-lived and must be stored. Both are packed into a JSON blob and encrypted as a single `encrypted_api_key` value. Token refresh is explicitly out of scope for this phase (handled in Phase 28).

The only migration needed is `ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'google_contacts'` — no new tables. This statement must run outside a transaction block; Supabase's migration runner handles this correctly when the statement is alone in the file, following the identical pattern used in `026_manychat_foundation.sql`.

**Primary recommendation:** Mirror `src/lib/meta/oauth.ts` → `src/lib/google-contacts/oauth.ts`, `src/app/api/meta/callback/route.ts` → `src/app/api/google/callback/route.ts`, and `src/app/(dashboard)/integrations/meta/actions.ts` → `src/app/(dashboard)/integrations/google-contacts/actions.ts`. Add migration `028_google_contacts_provider.sql` for enum extension only.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use env vars `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — consistent with current Meta pattern (`META_APP_ID`/`META_APP_SECRET`). Move to platform_settings in a future milestone.
- **D-02:** `encrypted_api_key` → AES-256-GCM encrypted JSON blob: `{ access_token, refresh_token }`
- **D-03:** `config` JSONB → non-sensitive metadata: `{ token_expiry: string, google_email: string }`
- **D-04:** `key_hint` → Google account email (unencrypted, used for display in UI)
- **D-05:** `provider` = `'google_contacts'` (new enum value via migration)
- **D-06:** One Google account per org — `UNIQUE(organization_id, provider)` already enforced by existing schema
- **D-07:** Follow Meta OAuth pattern exactly: server action `connectGoogleContacts` → CSRF cookie → redirect to Google consent → callback route `/api/google/callback` → encrypt + upsert → redirect to `/integrations/google-contacts?connected=true`
- **D-08:** OAuth scope: `https://www.googleapis.com/auth/contacts`
- **D-09:** Callback route resolves `org_id` from authenticated session via `supabase.rpc('get_current_org_id')` — never trusts org from request params
- **D-10:** CSRF state cookie: `google_oauth_state`, 10-min TTL, httpOnly + sameSite=lax
- **D-11:** Delete the `integrations` row for `provider = 'google_contacts'` for the current org — same pattern as other integrations

### Claude's Discretion

- Token payload JSON structure within `encrypted_api_key`
- Error redirect paths (mirror Meta: `?error=missing_code`, `?error=csrf`, `?error=no_org`, `?error=oauth_exchange`)
- Exact file structure for `src/lib/google-contacts/`

### Deferred Ideas (OUT OF SCOPE)

- Move `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to platform_settings — future milestone
- Token refresh background job — Phase 28 concern
- Multiple Google accounts per org — Future Requirements in REQUIREMENTS.md
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GCONTACTS-01 | Admin can connect a Google account via OAuth (Google OAuth 2.0 per org, stored encrypted via AES-256-GCM) | Google OAuth authorization endpoint, token exchange, `encrypt()` from crypto.ts, `integrations` table upsert |
| GCONTACTS-02 | Admin can disconnect the Google account integration | Delete row from `integrations` where `provider='google_contacts'` and `organization_id=get_current_org_id()` |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Web Crypto API | Browser built-in | AES-256-GCM encrypt/decrypt via `src/lib/crypto.ts` | Already in use — `encrypt()` handles JSON strings |
| Next.js App Router | 15 (project) | Route handlers (`export const runtime = 'nodejs'`), server actions | Project standard |
| Supabase JS client | Project version | Authenticated DB client, RLS-scoped upsert/delete | Project standard |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `next/headers` cookies() | Next.js 15 | Set/get CSRF state cookie | In callback route and server action |
| `next/navigation` redirect() | Next.js 15 | Server-side redirect in server action | `connectGoogleContacts` server action |
| `next/server` NextResponse | Next.js 15 | Response redirect in route handler | Callback route |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `fetch` for token exchange | `google-auth-library` npm package | npm package adds 200KB+ to bundle; raw fetch is sufficient given the narrow scope (one endpoint, two calls) and mirrors existing Meta pattern |
| Separate token columns | Encrypted JSON blob in `encrypted_api_key` | Locked decision D-02; reuses existing table without schema changes |

**Installation:** No new npm packages required. The implementation uses only built-in Next.js primitives and the existing crypto/supabase infrastructure.

---

## Google OAuth 2.0 — Exact Endpoints and Parameters

### Authorization URL (Step 1 — redirect user here)

**Endpoint:** `https://accounts.google.com/o/oauth2/v2/auth`

**Required parameters:**

| Parameter | Value |
|-----------|-------|
| `client_id` | `process.env.GOOGLE_CLIENT_ID` |
| `redirect_uri` | `https://operator.skale.club/api/google/callback` |
| `response_type` | `code` |
| `scope` | `https://www.googleapis.com/auth/contacts` |
| `state` | CSRF UUID |
| `access_type` | `offline` — **CRITICAL: required to receive `refresh_token`** |

Without `access_type=offline`, Google does not return a `refresh_token`. The refresh token is only needed by Phase 28, but it must be stored now or re-auth will be required later. Always request offline access.

### Token Exchange (Step 2 — after callback with `code`)

**Endpoint:** `https://oauth2.googleapis.com/token` (POST with `application/x-www-form-urlencoded` body)

**Required parameters:**

| Parameter | Value |
|-----------|-------|
| `code` | Authorization code from callback query param |
| `client_id` | `process.env.GOOGLE_CLIENT_ID` |
| `client_secret` | `process.env.GOOGLE_CLIENT_SECRET` |
| `redirect_uri` | `https://operator.skale.club/api/google/callback` |
| `grant_type` | `authorization_code` |

**Response shape:**

```typescript
type GoogleTokenResponse = {
  access_token: string
  refresh_token: string    // only present when access_type=offline AND first grant
  expires_in: number       // seconds; typically 3599 or 3920
  token_type: string       // always "Bearer"
  scope: string
}
```

**Access token lifetime:** ~3600 seconds (1 hour). `expires_in` from the response is the authoritative value. Store `token_expiry` as `new Date(Date.now() + expires_in * 1000).toISOString()` in `config.token_expiry`.

### Fetching the Google Account Email (Step 3 — to populate `key_hint`)

Call `https://www.googleapis.com/oauth2/v2/userinfo` or `https://people.googleapis.com/v1/people/me?personFields=emailAddresses` with `Authorization: Bearer {access_token}`. The `email` field from the response goes into both `key_hint` and `config.google_email`.

Alternatively, Google's token response does not include `email` — a separate `userinfo` call is required.

---

## Architecture Patterns

### Recommended File Structure

```
src/
  lib/google-contacts/
    oauth.ts              # Constants, buildAuthUrl(), exchangeCodeForTokens(), fetchGoogleUserEmail()
  app/
    api/google/
      callback/
        route.ts          # GET handler — CSRF check → token exchange → encrypt → upsert → redirect
    (dashboard)/
      integrations/
        google-contacts/
          actions.ts      # connectGoogleContacts() server action, disconnectGoogleContacts() server action
supabase/
  migrations/
    028_google_contacts_provider.sql   # ALTER TYPE + .env.local notes
```

### Pattern 1: OAuth Constants File (`src/lib/google-contacts/oauth.ts`)

Mirror `src/lib/meta/oauth.ts` exactly:

```typescript
// Source: src/lib/meta/oauth.ts (project reference)
export const GOOGLE_CALLBACK_PATH = '/api/google/callback'
export const GOOGLE_CALLBACK_URI = `https://operator.skale.club${GOOGLE_CALLBACK_PATH}`
export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state'
export const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10

export const GOOGLE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/contacts'

function getGoogleEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured.')
  }
  return { clientId, clientSecret }
}

export function buildGoogleOAuthUrl(state: string): string {
  const { clientId } = getGoogleEnv()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', GOOGLE_CALLBACK_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_OAUTH_SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')  // REQUIRED for refresh_token
  return url.toString()
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getGoogleEnv()
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: GOOGLE_CALLBACK_URI,
    grant_type: 'authorization_code',
  })
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })
  if (!response.ok) { /* throw */ }
  return response.json()
}
```

### Pattern 2: Callback Route (`src/app/api/google/callback/route.ts`)

```typescript
// Source: src/app/api/meta/callback/route.ts (project reference)
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<Response> {
  // 1. getUser() — redirect to /login if unauthenticated
  // 2. Extract code + state from URL, storedState from cookie
  // 3. clearStateCookie()
  // 4. Guard: !code → redirect /integrations/google-contacts?error=missing_code
  // 5. Guard: state mismatch → redirect /integrations/google-contacts?error=csrf
  // 6. supabase.rpc('get_current_org_id') → guard !orgId → ?error=no_org
  // 7. exchangeCodeForTokens(code)
  // 8. fetchGoogleUserEmail(tokens.access_token)
  // 9. encrypt(JSON.stringify({ access_token, refresh_token }))
  // 10. supabase.from('integrations').upsert({
  //       organization_id: orgId,
  //       provider: 'google_contacts',
  //       name: 'Google Contacts',
  //       encrypted_api_key: encryptedBlob,
  //       key_hint: googleEmail,
  //       config: { token_expiry, google_email },
  //       is_active: true,
  //     }, { onConflict: 'organization_id,provider' })
  // 11. redirect /integrations/google-contacts?connected=true
  // catch → redirect /integrations/google-contacts?error=oauth_exchange
}
```

### Pattern 3: Server Actions (`src/app/(dashboard)/integrations/google-contacts/actions.ts`)

```typescript
// Source: src/app/(dashboard)/integrations/meta/actions.ts (project reference)
'use server'

export async function connectGoogleContacts(): Promise<never> {
  // getUser() + redirect to /login if absent
  // createClient() + rpc('get_current_org_id') + redirect to ?error=no_org if absent
  // state = crypto.randomUUID()
  // jar.set(GOOGLE_OAUTH_STATE_COOKIE, state, cookieOptions)
  // redirect(buildGoogleOAuthUrl(state))
}

export async function disconnectGoogleContacts(): Promise<{ error?: string }> {
  // getUser() guard
  // supabase.from('integrations').delete()
  //   .eq('organization_id', orgId)
  //   .eq('provider', 'google_contacts')
  // revalidatePath('/integrations')
  // revalidatePath('/integrations/google-contacts')
}
```

### Pattern 4: Migration (`supabase/migrations/028_google_contacts_provider.sql`)

```sql
-- Source: supabase/migrations/026_manychat_foundation.sql (project reference)
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a BEGIN/COMMIT block.
-- Supabase migration runner executes this outside a transaction, same as 026.
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'google_contacts';
```

**Migration number:** The highest existing migration is `027_manychat_rules.sql`. The next migration is `028`.

### Anti-Patterns to Avoid

- **Requesting `access_type=online` (default):** Google will NOT return a `refresh_token`. Phase 28 needs it — always use `offline`.
- **Storing `refresh_token` in `config` JSONB:** `config` is non-sensitive metadata per D-03. The refresh token must go inside the AES-encrypted `encrypted_api_key` blob.
- **Trusting `org_id` from request body or query params:** Per D-09, always resolve from `supabase.rpc('get_current_org_id')`.
- **Importing `node:crypto`:** `src/lib/crypto.ts` uses Web Crypto API only and explicitly forbids `node:crypto` imports for Edge Runtime compatibility. The callback route uses `export const runtime = 'nodejs'` but still calls `encrypt()` which relies on Web Crypto — do not change this.
- **Wrapping the enum migration in an explicit transaction:** Supabase handles migrations outside transactions; adding `BEGIN/COMMIT` around `ALTER TYPE ADD VALUE` will fail.
- **Calling `supabase.auth.getUser()` directly:** Always use the cached `getUser()` from `@/lib/supabase/server`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AES-256-GCM encryption | Custom encryption | `encrypt()` from `src/lib/crypto.ts` | Already audited; format locked — do not change |
| CSRF state | Custom state mechanism | `crypto.randomUUID()` + httpOnly cookie | Already established project pattern |
| Org scoping | Manual `organization_id` filters | `supabase.rpc('get_current_org_id')` + RLS | Multi-tenant isolation — bypassing breaks security model |
| Token exchange | OAuth library | Raw `fetch` to `https://oauth2.googleapis.com/token` | Mirrors Meta pattern; no library needed for a single POST |

---

## Common Pitfalls

### Pitfall 1: Missing `access_type=offline` in Authorization URL

**What goes wrong:** Google's token exchange returns an `access_token` but no `refresh_token`. Phase 28 cannot refresh tokens, forcing users to re-authenticate every hour.
**Why it happens:** `access_type=online` is Google's default. The parameter must be explicitly set.
**How to avoid:** Always include `url.searchParams.set('access_type', 'offline')` in `buildGoogleOAuthUrl()`.
**Warning signs:** `refresh_token` field is absent from the `GoogleTokenResponse` object at runtime.

### Pitfall 2: `refresh_token` Only Returned on First Authorization Grant

**What goes wrong:** After the first successful auth, subsequent re-authorizations by the same Google account do not return a `refresh_token` (Google omits it after the initial grant).
**Why it happens:** Google's security model: once a refresh token has been issued for a client+user pair, it is not re-issued unless the user explicitly revokes and re-grants access or the app requests `prompt=consent`.
**How to avoid:** The upsert in Phase 27 always overwrites `encrypted_api_key`. During the token exchange, check `if (!tokens.refresh_token)` and handle gracefully (log warning; if reconnecting, attempt to re-use the existing stored refresh token, or prompt `prompt=consent`). For Phase 27 initial implementation, assume first-time connect — the absence of a `refresh_token` on reconnect should not cause a crash but should be logged.
**Warning signs:** `tokens.refresh_token` is `undefined` on the second connect attempt for the same Google account.

### Pitfall 3: `redirect_uri` Mismatch

**What goes wrong:** Google returns `redirect_uri_mismatch` error; OAuth flow fails before reaching the callback.
**Why it happens:** The `redirect_uri` used in the authorization URL and token exchange must exactly match a URI registered in Google Cloud Console. Even trailing slashes cause failures.
**How to avoid:** Register `https://operator.skale.club/api/google/callback` exactly (no trailing slash) in the Google Cloud Console OAuth 2.0 credentials. Use the constant `GOOGLE_CALLBACK_URI` in both `buildGoogleOAuthUrl()` and `exchangeCodeForTokens()`.
**Warning signs:** Google returns the user to the callback with `?error=redirect_uri_mismatch` instead of `?code=...`.

### Pitfall 4: Token Exchange Uses Form Encoding, Not JSON

**What goes wrong:** Google's token endpoint returns a 400 error if `Content-Type: application/json` is used.
**Why it happens:** `https://oauth2.googleapis.com/token` requires `application/x-www-form-urlencoded` body, not JSON. This differs from many modern APIs.
**How to avoid:** Use `new URLSearchParams({...}).toString()` as the body, with `Content-Type: application/x-www-form-urlencoded` header.

### Pitfall 5: `encrypt()` Expects a String, Not an Object

**What goes wrong:** TypeScript error or runtime failure when passing an object to `encrypt()`.
**Why it happens:** `src/lib/crypto.ts`'s `encrypt(plaintext: string)` accepts only strings.
**How to avoid:** Always serialize first: `encrypt(JSON.stringify({ access_token, refresh_token }))`.

### Pitfall 6: Enum Migration Number Collision

**What goes wrong:** Supabase rejects or ignores a migration with the same number as an existing one.
**Why it happens:** Current highest migration is `027_manychat_rules.sql`. The new migration must be `028_google_contacts_provider.sql`.
**How to avoid:** Verify `ls supabase/migrations/` before naming the file. Use `028`.

---

## Database Schema — Confirmed Facts

### `integrations` table (lines 162–206 of `src/types/database.ts`)

The table already exists with:
- `organization_id` — FK to `organizations`
- `provider` — `integration_provider` enum (currently without `'google_contacts'`)
- `name` — display name (use `'Google Contacts'`)
- `encrypted_api_key` — store `encrypt(JSON.stringify({ access_token, refresh_token }))`
- `key_hint` — Google account email (unencrypted)
- `config` — JSONB (store `{ token_expiry: string, google_email: string }`)
- `is_active` — boolean

**Unique constraint confirmed:** `supabase/migrations/009_unique_provider_per_org.sql` created `CONSTRAINT integrations_org_provider_unique UNIQUE (organization_id, provider)`. The upsert `onConflict: 'organization_id,provider'` will work.

### `integration_provider` enum (line 1093 of `src/types/database.ts`)

Current values: `'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat'`

After migration 028: add `'google_contacts'`.

**TypeScript update required:** After running `npx supabase db push`, manually add `'google_contacts'` to the `integration_provider` union type in `src/types/database.ts` at line 1093, and to the `provider` field union in the `integrations` table `Row` and `Insert` types at lines 166 and 179.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `GOOGLE_CLIENT_ID` env var | OAuth authorization URL builder | Not yet set | — | Must be set before OAuth flow works; app will throw at runtime with clear error message |
| `GOOGLE_CLIENT_SECRET` env var | Token exchange | Not yet set | — | Same — `getGoogleEnv()` throws with descriptive message |
| `ENCRYPTION_SECRET` env var | `src/lib/crypto.ts` | Already set (used by Meta integration) | 64-char hex | — |
| Google Cloud Console OAuth app | Redirect URI registration | Not yet configured | — | Manual step — must register `https://operator.skale.club/api/google/callback` |

**Missing dependencies with no fallback:**
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — must be obtained from Google Cloud Console and added to `.env.local` and `.env.local.example`
- Google Cloud Console OAuth 2.0 credential with `https://operator.skale.club/api/google/callback` registered as authorized redirect URI — this is a manual platform configuration step, not a code task

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts in project root) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/google-oauth-actions.test.ts tests/google-callback-route.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GCONTACTS-01 | `connectGoogleContacts` sets CSRF cookie and redirects to Google auth URL | unit | `npx vitest run tests/google-oauth-actions.test.ts` | Wave 0 |
| GCONTACTS-01 | Callback validates CSRF state, exchanges code, encrypts tokens, upserts integrations row | unit | `npx vitest run tests/google-callback-route.test.ts` | Wave 0 |
| GCONTACTS-01 | Callback redirects to `?error=missing_code` when code absent | unit | `npx vitest run tests/google-callback-route.test.ts` | Wave 0 |
| GCONTACTS-01 | Callback redirects to `?error=csrf` on state mismatch | unit | `npx vitest run tests/google-callback-route.test.ts` | Wave 0 |
| GCONTACTS-01 | Callback redirects to `?error=oauth_exchange` on token exchange failure | unit | `npx vitest run tests/google-callback-route.test.ts` | Wave 0 |
| GCONTACTS-02 | `disconnectGoogleContacts` deletes the integrations row for the active org | unit | `npx vitest run tests/google-oauth-actions.test.ts` | Wave 0 |

**Test pattern reference:** `tests/meta-callback-route.test.ts` and `tests/meta-oauth-actions.test.ts` are direct templates. Both use `it.todo()` stubs — the Google equivalents should follow the same stub-first pattern.

### Wave 0 Gaps

- [ ] `tests/google-oauth-actions.test.ts` — covers GCONTACTS-01 (connect action) and GCONTACTS-02 (disconnect action)
- [ ] `tests/google-callback-route.test.ts` — covers GCONTACTS-01 (full callback flow including CSRF, token exchange, upsert, error cases)

*(No framework gaps — Vitest is already installed and configured. Test files are the only missing pieces.)*

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on This Phase |
|-----------|---------------------|
| Always use `getUser()` and `createClient()` from `@/lib/supabase/server` | Callback route and server actions must import from this path |
| Never call `supabase.auth.getUser()` directly | Use cached `getUser()` everywhere |
| `export const runtime = 'nodejs'` on route handlers | Required on `src/app/api/google/callback/route.ts` |
| Never edit old migrations — add new ones | New file `028_google_contacts_provider.sql` only |
| `src/lib/crypto.ts` — do not change encryption format | Use `encrypt()`/`decrypt()` as-is |
| Run `npm run build` after changes to catch type errors | Must run after updating `src/types/database.ts` |
| `npx supabase db push` after adding a migration | Required after writing 028 migration |
| Update `src/types/database.ts` after migration | Add `'google_contacts'` to enum and `integrations` provider unions |

---

## Sources

### Primary (HIGH confidence)

- Google Developers official docs (fetched): [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) — authorization URL, token exchange endpoint, required parameters, `access_type=offline`, response fields
- Project source code (read directly): `src/lib/meta/oauth.ts`, `src/app/api/meta/callback/route.ts`, `src/app/(dashboard)/integrations/meta/actions.ts` — canonical pattern reference
- Project source code (read directly): `src/lib/crypto.ts` — encryption interface
- Project source code (read directly): `src/types/database.ts` — `integrations` table schema, `integration_provider` enum
- Project source code (read directly): `supabase/migrations/009_unique_provider_per_org.sql` — unique constraint confirmation
- Project source code (read directly): `supabase/migrations/026_manychat_foundation.sql` — enum extension migration pattern

### Secondary (MEDIUM confidence)

- WebSearch verified with official source: PostgreSQL `ALTER TYPE ADD VALUE` cannot run inside a transaction block — confirmed by PostgreSQL docs and Supabase migration runner behavior matches `026_manychat_foundation.sql` comment

### Tertiary (LOW confidence)

- WebSearch: Google refresh token only issued on first grant / `prompt=consent` required to force re-issue — consistent with official docs but specific behavior around re-connect edge case not verified against a live app

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use in the project
- Google OAuth endpoints: HIGH — verified against official Google developer documentation
- Architecture patterns: HIGH — direct port of existing Meta OAuth implementation
- Database migration: HIGH — identical pattern to `026_manychat_foundation.sql` already in the project
- Refresh token edge cases: MEDIUM — documented behavior but not tested against a live Google Cloud Console app

**Research date:** 2026-05-06
**Valid until:** 2026-08-06 (Google OAuth endpoints are stable; 90-day validity)

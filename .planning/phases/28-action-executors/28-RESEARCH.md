# Phase 28: Action Executors - Research

**Researched:** 2026-05-07
**Domain:** Google People API, OAuth token refresh, action engine extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Refresh-on-401 pattern — call People API with current `access_token`; if response is 401, use `refresh_token` to obtain a new `access_token` from Google token endpoint (`https://oauth2.googleapis.com/token`), persist the updated encrypted blob and new `token_expiry` to the `integrations` row, then retry the original API call once. If the refresh itself fails, throw with a clear message.

**D-02:** Token persistence on refresh: update `encrypted_api_key` (new AES-256-GCM blob of `{ access_token, refresh_token }`) and `config.token_expiry` in the `integrations` row for the org. The executor receives `organizationId + supabase` via `ActionContext` — use these to fetch and persist.

**D-03:** Return a single-line summary string consistent with all existing executors (no newlines — Vapi parser breaks on `\n`):
- Match found: `"Found: {displayName} | {emailAddress} | {phoneNumber}"` — omit absent fields
- No match: `"No contact found matching that query."`
- Multiple matches: return the first result with a note: `"Found: {displayName} | {email} (1 of {N} matches)"`

**D-04:** `find` searches by email OR phone (whichever is provided in params) using the People API `people.searchContacts` endpoint with the value as the query string.

**D-05:** When no `integrations` row exists for `provider = 'google_contacts'` for the current org, throw: `new Error('Google Contacts not connected for this org. Connect via /integrations.')` — the action engine catches, logs as failed, returns the error string to the caller. Does NOT crash the engine.

**D-06:** Add a new `resolveGoogleCredentials(ctx: ActionContext): Promise<GoogleOAuthTokens>` helper in `src/lib/google-contacts/credentials.ts` — fetches the `integrations` row, decrypts `encrypted_api_key`, returns `{ access_token, refresh_token, token_expiry }`. This keeps credential resolution out of each executor.

**D-07:** Each executor calls `resolveGoogleCredentials`, then calls the People API. Token refresh logic lives inside `resolveGoogleCredentials` (or a wrapper `callWithRefresh`).

**D-08:** The `executeAction` dispatcher passes the existing `ActionContext` (`organizationId + supabase`) to google_contacts cases. `GhlCredentials` is not needed for these cases — the switch branch calls executors without it.

**D-09:** 4 executor files under `src/lib/google-contacts/`: `create-contact.ts`, `update-contact.ts`, `find-contact.ts`, `delete-contact.ts`.

**D-10:** New migration (029) adds 4 values to the `action_type` enum: `google_contacts_create`, `google_contacts_update`, `google_contacts_find`, `google_contacts_delete`. Update `src/types/database.ts` after migration.

**D-11:** Standard fields per ROADMAP: `name` (full name → `givenName`/`familyName` split), `email`, `phone`, `company` (→ `organizations[0].name`), `notes` (→ `biographies[0].value`). Params keys follow the same flat-object convention as existing GHL executors.

**D-12:** `update` locates the contact by email first (`find` logic), then calls `people.updateContact` with the `resourceName`. If not found, throw: `new Error('Contact not found for update: {email}')`.

**D-13:** `delete` locates by email, calls `people.deleteContact`. If not found, throw: `new Error('Contact not found for delete: {email}')`.

### Claude's Discretion
- People API pagination handling in `find` (return first result only)
- Exact URL construction for People API calls (use `https://people.googleapis.com/v1/`)
- `updatePersonFields` mask construction for `update` (include only fields present in params)
- `readMask` selection for `connections.list` responses

### Deferred Ideas (OUT OF SCOPE)
- Batch operations (create/update/delete multiple contacts in one action call)
- Token refresh as a background cron job (proactive before expiry)
- Multiple Google accounts per org
- Scopes beyond `contacts` (e.g., Calendar, Gmail)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACTIONS-01 | `google_contacts_create` action type creates a contact in Google Contacts with standard fields (name, email, phone, company, notes) | People API POST `/v1/people:createContact` with names/emailAddresses/phoneNumbers/organizations/biographies |
| ACTIONS-02 | `google_contacts_update` action type updates fields on an existing contact identified by email | searchContacts to find resourceName + etag, then PATCH `/v1/{resourceName}:updateContact` with `updatePersonFields` mask |
| ACTIONS-03 | `google_contacts_find` action type searches for a contact by email or phone and returns matching data | `people.searchContacts?query={value}&readMask=names,emailAddresses,phoneNumbers` |
| ACTIONS-04 | `google_contacts_delete` action type removes a contact from Google Contacts identified by email | searchContacts to find resourceName, then DELETE `/v1/{resourceName}:deleteContact` |
</phase_requirements>

---

## Summary

Phase 28 adds 4 Google People API executor functions to the existing action engine. The core pattern follows the established GHL executor template: a function that accepts `params: Record<string, unknown>` and returns a `Promise<string>`, with all DB/credential work delegated to a shared helper (`credentials.ts`).

The most important architectural detail is the **update flow requires two API calls**: (1) `searchContacts` to find the contact's `resourceName` and `etag`, then (2) `updateContact` PATCH with the `etag` in the request body. The `etag` is mandatory — omitting it causes a 400 `failedPrecondition` error from Google. The same two-step pattern applies to delete (find, then delete by `resourceName`).

Token refresh is a 401-retry wrapper: make the API call, detect 401, exchange `refresh_token` at `https://oauth2.googleapis.com/token`, persist the new `access_token` to the `integrations` row via Supabase, and retry once. The refresh response does NOT return a new `refresh_token` — reuse the original.

The DB migration is `029_google_contacts_actions.sql` — the next number after `028_google_contacts_foundation.sql`. It extends the `action_type` enum with 4 new values.

**Primary recommendation:** Implement `credentials.ts` with `resolveGoogleCredentials` + `callWithRefresh` first; each executor is then a thin wrapper around a single People API fetch call.

---

## Project Constraints (from CLAUDE.md)

| Directive | Applies To |
|-----------|-----------|
| Always run `npm run build` after changes to catch type errors | Every plan |
| TypeScript strict mode | All new files |
| Server components by default; `'use client'` only when needed | N/A — no UI in this phase |
| Toasts use `sonner`; forms use react-hook-form + zod | N/A — no UI in this phase |
| Inbound webhooks always return HTTP 200 | N/A — no webhook in this phase |
| `createClient` / `getUser` cached helpers — never call `supabase.auth.getUser()` directly | `credentials.ts` uses `ctx.supabase` (already correct — executors receive ctx, not raw auth) |
| Never edit old migrations; add new ones | Migration 029 must be a new file |
| `src/lib/crypto.ts` format must not change | Use `encrypt`/`decrypt` as-is |
| `export const runtime = 'nodejs'` for API routes | N/A — no new routes in this phase |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` | built-in | HTTP calls to People API | Codebase uses native fetch throughout (see `oauth.ts`, `ghl/client.ts`) |
| `@/lib/crypto` | project | AES-256-GCM encrypt/decrypt tokens | Already used by all credential storage |
| `@/lib/google-contacts/oauth.ts` | project | `GoogleTokenResponse` type, env var access | Established in Phase 27 |
| `@supabase/supabase-js` | existing | Persist refreshed token to `integrations` row | Flows in via `ActionContext.supabase` |

### No New Third-Party Dependencies
The executors use native `fetch` (same pattern as `oauth.ts` and GHL executors). No googleapis SDK, no axios. This keeps the bundle clean and avoids SDK version pinning.

---

## Architecture Patterns

### Recommended File Structure
```
src/lib/google-contacts/
├── oauth.ts                    # EXISTING — OAuth utilities, GoogleTokenResponse
├── credentials.ts              # NEW — resolveGoogleCredentials + callWithRefresh
├── create-contact.ts           # NEW — ACTIONS-01 executor
├── update-contact.ts           # NEW — ACTIONS-02 executor
├── find-contact.ts             # NEW — ACTIONS-03 executor
└── delete-contact.ts           # NEW — ACTIONS-04 executor

src/lib/action-engine/
└── execute-action.ts           # EXTEND — add 4 new cases in the switch

supabase/migrations/
└── 029_google_contacts_actions.sql  # NEW — extends action_type enum

src/types/
└── database.ts                 # UPDATE — add 4 new action_type values

tests/
└── google-contacts-executors.test.ts  # NEW — RED stubs for all 4 executors
```

### Pattern 1: Token Blob Format in `integrations.encrypted_api_key`

The Phase 27 callback stores this JSON as the encrypted blob (confirmed from STATE.md and Phase 27 context):

```typescript
// Stored as: encrypt(JSON.stringify({ access_token, refresh_token, token_expiry, google_email }))
// But only access_token and refresh_token are needed for API calls.
// token_expiry is stored in config JSONB (config.token_expiry).

interface GoogleOAuthTokens {
  access_token: string
  refresh_token: string
  token_expiry?: number   // unix epoch ms — from config JSONB, not the blob
  google_email?: string
}
```

The `resolveGoogleCredentials` helper must:
1. Query `integrations` where `provider = 'google_contacts'` AND `organization_id = ctx.organizationId`
2. If no row → throw D-05 error
3. `decrypt(row.encrypted_api_key)` → `JSON.parse()` → extract `access_token`, `refresh_token`
4. Optionally extract `token_expiry` from `row.config` JSONB for pre-expiry check

### Pattern 2: `callWithRefresh` Wrapper

```typescript
// Source: D-01, D-02 decisions + official Google OAuth 2.0 docs
async function callWithRefresh<T>(
  access_token: string,
  refresh_token: string,
  integrationId: string,
  ctx: ActionContext,
  apiFn: (token: string) => Promise<Response>
): Promise<Response> {
  let res = await apiFn(access_token)
  if (res.status !== 401) return res

  // Refresh the token
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token,
    grant_type: 'refresh_token',
  })
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  })
  if (!refreshRes.ok) {
    throw new Error('Google token refresh failed — reconnect via /integrations.')
  }

  const refreshData = await refreshRes.json() as { access_token: string; expires_in: number }
  const newExpiry = Date.now() + refreshData.expires_in * 1000

  // Persist new access_token (keep same refresh_token — Google does NOT return a new one)
  const newBlob = await encrypt(JSON.stringify({
    access_token: refreshData.access_token,
    refresh_token,
  }))
  await ctx.supabase
    .from('integrations')
    .update({
      encrypted_api_key: newBlob,
      config: { token_expiry: newExpiry } as Json,
    })
    .eq('id', integrationId)

  // Retry once with fresh token
  return apiFn(refreshData.access_token)
}
```

Key facts:
- Google's token refresh response contains `access_token` and `expires_in` but NOT a new `refresh_token` (HIGH confidence — confirmed by official docs)
- The `content-type` for the refresh POST must be `application/x-www-form-urlencoded` (same as `exchangeCodeForTokens` in `oauth.ts`)
- `callWithRefresh` receives the integration row `id` to target the correct Supabase `update`

### Pattern 3: Executor Template (modeled on GHL executor)

```typescript
// src/lib/google-contacts/create-contact.ts
import type { ActionContext } from '@/lib/action-engine/execute-action'
import { resolveGoogleCredentials } from './credentials'

interface CreateContactParams {
  name?: string
  email?: string
  phone?: string
  company?: string
  notes?: string
  [key: string]: unknown
}

export async function createGoogleContact(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  const { access_token, refresh_token, integrationId } = await resolveGoogleCredentials(ctx)
  const { name, email, phone, company, notes } = params as CreateContactParams

  // Split name into givenName/familyName (see Field Mapping section below)
  const nameParts = (name ?? '').trim().split(/\s+/)
  const givenName = nameParts[0] ?? ''
  const familyName = nameParts.slice(1).join(' ')

  const body: Record<string, unknown> = {}
  if (name) body.names = [{ givenName, familyName }]
  if (email) body.emailAddresses = [{ value: email }]
  if (phone) body.phoneNumbers = [{ value: phone }]
  if (company) body.organizations = [{ name: company }]
  if (notes) body.biographies = [{ value: notes }]

  const res = await callWithRefresh(
    access_token, refresh_token, integrationId, ctx,
    (token) => fetch(
      'https://people.googleapis.com/v1/people:createContact?personFields=names,emailAddresses',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      }
    )
  )

  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`People API error ${res.status}: ${text}`)
  }

  const data = await res.json() as { resourceName: string }
  return `Google contact created. Resource: ${data.resourceName}`
}
```

### Pattern 4: execute-action.ts Extension

```typescript
// Add to the switch — BEFORE the default case
case 'google_contacts_create': {
  if (!ctx?.organizationId || !ctx?.supabase) {
    throw new Error('google_contacts_create requires ctx.organizationId and ctx.supabase')
  }
  return createGoogleContact(params, ctx)
}
case 'google_contacts_update': {
  if (!ctx?.organizationId || !ctx?.supabase) {
    throw new Error('google_contacts_update requires ctx')
  }
  return updateGoogleContact(params, ctx)
}
case 'google_contacts_find': {
  if (!ctx?.organizationId || !ctx?.supabase) {
    throw new Error('google_contacts_find requires ctx')
  }
  return findGoogleContact(params, ctx)
}
case 'google_contacts_delete': {
  if (!ctx?.organizationId || !ctx?.supabase) {
    throw new Error('google_contacts_delete requires ctx')
  }
  return deleteGoogleContact(params, ctx)
}
```

Note: The existing `default` case with TypeScript exhaustiveness check must remain as-is. The new cases go above it.

### Anti-Patterns to Avoid
- **Importing from `src/lib/ghl/`**: Google executors are fully independent. Do not share GHL client code.
- **Using displayName as input**: `displayName` is OUTPUT ONLY from the API. Use `givenName`/`familyName` for input. The CONTEXT.md decision D-11 says "name (full name → displayName)" but the actual API field is givenName+familyName — see Field Mapping section below.
- **Omitting etag on updateContact**: The PATCH request will fail with HTTP 400 `failedPrecondition`. Always fetch the contact first to get the current etag.
- **Single-step update/delete without find**: Both update and delete must find the contact by email first to get the resourceName.
- **Newlines in returned strings**: Vapi parser breaks on `\n`. All executor return strings must be single-line.
- **Using connections.list for search**: `searchContacts` is the correct endpoint for query-based search. `connections.list` requires pagination over potentially thousands of contacts. Use `searchContacts` as decided in D-04.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token encryption | Custom cipher | `encrypt`/`decrypt` from `@/lib/crypto.ts` | Format is locked — changing it breaks stored credentials |
| Token refresh logic | None | `callWithRefresh` helper in `credentials.ts` | Centralizes 401-retry; each executor should not duplicate this |
| URL-encoded POST body | Manual string concat | `URLSearchParams.toString()` | Same pattern used in `oauth.ts` `exchangeCodeForTokens` |
| Supabase auth | `supabase.auth.getUser()` | `ctx.supabase` (already authenticated client from ActionContext) | CLAUDE.md requirement; executors don't call auth directly |

---

## Google People API: Endpoint Reference

### 1. Create Contact
- **URL:** `POST https://people.googleapis.com/v1/people:createContact`
- **Query param:** `personFields=names,emailAddresses` (what to return in response)
- **Auth:** `Authorization: Bearer {access_token}`
- **Request body:**
```json
{
  "names": [{ "givenName": "João", "familyName": "Silva" }],
  "emailAddresses": [{ "value": "joao@example.com" }],
  "phoneNumbers": [{ "value": "+55 11 99999-9999" }],
  "organizations": [{ "name": "Acme Corp" }],
  "biographies": [{ "value": "Notes about this contact" }]
}
```
- **Response:** Person object with `resourceName: "people/{person_id}"` and requested fields
- **Constraint:** Names is a singleton field — only one entry in the array allowed (400 error if multiple)
- **Confidence:** HIGH (official docs + multiple corroborating sources)

### 2. Search Contacts (used by find, update, delete)
- **URL:** `GET https://people.googleapis.com/v1/people:searchContacts`
- **Query params:**
  - `query={email_or_phone}` — prefix-matches names, emails, phones, organizations
  - `readMask=names,emailAddresses,phoneNumbers` — required field mask
  - `pageSize=10` — default; max 30
- **Auth:** `Authorization: Bearer {access_token}`
- **Response:**
```json
{
  "results": [
    {
      "person": {
        "resourceName": "people/c1234567890",
        "etag": "%EgUBAi43PRoEAQIFByIMxxxxxxx=",
        "names": [{ "displayName": "João Silva", "givenName": "João", "familyName": "Silva" }],
        "emailAddresses": [{ "value": "joao@example.com" }],
        "phoneNumbers": [{ "value": "+55 11 99999-9999" }]
      }
    }
  ]
}
```
- **Warmup requirement:** The API docs state clients should send a warmup request with empty query before real searches to update the lazy cache. In practice, for serverless executors that call this infrequently, the recommendation is to always send the warmup before searching. However, this doubles API calls per find/update/delete. Given D-04 (find by email/phone — specific query), the warmup is a best-effort consideration, not a hard requirement. The plan should include the warmup step but allow skipping it given the overhead. **Confidence: MEDIUM** — Google docs mention it but don't enforce it as a hard error.

### 3. Get Person (needed before update to obtain etag)
- **URL:** `GET https://people.googleapis.com/v1/{resourceName}?personFields=names,emailAddresses,phoneNumbers,organizations,biographies`
- **Auth:** `Authorization: Bearer {access_token}`
- **Response:** Full Person object including top-level `etag` field
- The top-level `etag` on the Person object is what the update PATCH requires

### 4. Update Contact
- **URL:** `PATCH https://people.googleapis.com/v1/{resourceName}:updateContact?updatePersonFields={mask}`
- **`updatePersonFields` mask:** Comma-separated field names for ONLY the fields being updated
  - Include only fields present in params: e.g., `names,emailAddresses,phoneNumbers`
  - Mask values: `names`, `emailAddresses`, `phoneNumbers`, `organizations`, `biographies`
- **Auth:** `Authorization: Bearer {access_token}`
- **Request body:** Must include top-level `etag` from the GET response:
```json
{
  "etag": "%EgUBAi43PRoEAQIFByIMxxxxxxx=",
  "names": [{ "givenName": "João", "familyName": "Updated" }],
  "emailAddresses": [{ "value": "new@example.com" }]
}
```
- **Critical:** Omitting `etag` causes HTTP 400 `failedPrecondition`. The etag comes from `GET /v1/{resourceName}` or from a prior `searchContacts` result.
- **Confidence:** HIGH (official docs + GitHub issues confirmed)

### 5. Delete Contact
- **URL:** `DELETE https://people.googleapis.com/v1/{resourceName}:deleteContact`
- **Auth:** `Authorization: Bearer {access_token}`
- **Body:** Empty
- **Response:** Empty body on success (HTTP 200)
- **Confidence:** HIGH (official docs)

---

## Field Mapping: Params → People API

| Param key (flat) | People API field path | Notes |
|------------------|-----------------------|-------|
| `name` (string) | `names[0].givenName` + `names[0].familyName` | Split on first whitespace: `"João Silva"` → `givenName: "João"`, `familyName: "Silva"`. Single word → `givenName` only. `displayName` is OUTPUT ONLY — cannot be set. |
| `email` (string) | `emailAddresses[0].value` | Direct value |
| `phone` (string) | `phoneNumbers[0].value` | Direct value |
| `company` (string) | `organizations[0].name` | |
| `notes` (string) | `biographies[0].value` | The `biographies` field is a singleton; only one entry allowed |

**CRITICAL NOTE on `displayName`:** The CONTEXT.md D-11 says "name → displayName" but this is the OUTPUT field name. The API returns `displayName` in responses (computed by Google from givenName/familyName), but for CREATE and UPDATE inputs you must use `givenName` and `familyName`. Attempting to set `displayName` in the request body has no effect — it is read-only. The executor should split the flat `name` param into `givenName`/`familyName`.

### `updatePersonFields` Mask Construction
Build the mask dynamically from the params provided:

```typescript
const fieldMap: Record<string, string> = {
  name: 'names',
  email: 'emailAddresses',
  phone: 'phoneNumbers',
  company: 'organizations',
  notes: 'biographies',
}
const mask = Object.keys(params)
  .filter(k => fieldMap[k] && params[k])
  .map(k => fieldMap[k])
  .join(',')
// Example: params = { name: 'João', email: 'joao@x.com' } → mask = 'names,emailAddresses'
```

The mask must list only fields that are actually being updated, not all possible fields. This is a hard requirement — "All updated fields will be replaced."

---

## Update Flow: Two-Step Required

The `update-contact.ts` executor must perform this sequence:

1. Call `searchContacts` with `query={params.email}` to get `resourceName`
2. If no result → throw `new Error('Contact not found for update: {email}')`
3. Call `GET /v1/{resourceName}?personFields=names,emailAddresses,phoneNumbers,organizations,biographies` to fetch the current `etag`
4. Build the update body with the current `etag` and only the changed fields
5. Call `PATCH /v1/{resourceName}:updateContact?updatePersonFields={mask}` with the body

Alternatively, the `etag` from `searchContacts` results IS the same etag. The `person.etag` in search results can be used directly for the update, eliminating the separate GET call.

**Optimization:** Use `etag` from the `searchContacts` result directly — no separate GET needed. Include `etag` as a top-level field in the PATCH body. This is confirmed by the API reference showing search results include `etag`.

```typescript
// result.person.etag from searchContacts → used directly in updateContact body
const updateBody = {
  etag: result.person.etag,
  ...fieldsToUpdate
}
```

This reduces 3 API calls (search + GET + PATCH) to 2 (search + PATCH).

---

## DB Migration

**Next migration number:** `029`

The highest existing migration is `028_google_contacts_foundation.sql` which added `google_contacts` to `integration_provider`. Migration 029 extends `action_type`.

**File:** `supabase/migrations/029_google_contacts_actions.sql`

```sql
-- =============================================================================
-- Migration: 029_google_contacts_actions
-- Phase: v1.7 Google Contacts Integration — Phase 28 Action Executors
-- Extends: action_type enum with 4 google_contacts_* values
-- NOTE: PostgreSQL enum ADD VALUE cannot run inside a BEGIN/COMMIT block.
-- =============================================================================

ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'google_contacts_create';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'google_contacts_update';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'google_contacts_find';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'google_contacts_delete';
```

**Pattern precedent:** Migration 028 uses the same `ADD VALUE IF NOT EXISTS` pattern. PostgreSQL requires `ADD VALUE` to run outside a transaction block (no `BEGIN/COMMIT`). Supabase's migration runner handles this correctly.

**database.ts update after migration:**

In `src/types/database.ts`, extend `action_type` in all 3 locations where it appears:
1. `tool_configs.Row.action_type` (line ~214)
2. `tool_configs.Insert.action_type` (line ~228)
3. `tool_configs.Update.action_type` (line ~240)
4. `Enums.action_type` (line ~1092)

Add these 4 values: `'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete'`

---

## Extending execute-action.ts Without Breaking Existing Cases

The current `executeAction` signature is:

```typescript
export async function executeAction(
  actionType: ActionType,
  params: Record<string, unknown>,
  credentials: GhlCredentials,
  ctx?: ActionContext
): Promise<string>
```

**Key constraint:** `credentials: GhlCredentials` is positional and required — all existing callers (Vapi tools route, manychat dispatch) pass it. The google_contacts cases receive `ctx` and IGNORE `credentials`.

**No signature change needed.** The 4 new cases simply do not use the `credentials` argument:

```typescript
case 'google_contacts_create': {
  if (!ctx?.organizationId || !ctx?.supabase) {
    throw new Error('google_contacts_create requires ctx')
  }
  return createGoogleContact(params, ctx)
  // credentials is not passed — ignored intentionally
}
```

This maintains backward compatibility with all existing callers. The `credentials` argument is typed as `GhlCredentials` and remains required at the call site; it just goes unused in the new cases.

**TypeScript exhaustiveness:** The `default: never` branch will enforce that all enum values have a case once the enum is updated in `database.ts`. This means after the enum update, TypeScript will error until all 4 new cases are added — which is the intended compile-time guard.

---

## Token Refresh: Detailed Implementation Notes

### Refresh Endpoint
```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id={GOOGLE_CLIENT_ID}
&client_secret={GOOGLE_CLIENT_SECRET}
&refresh_token={stored_refresh_token}
&grant_type=refresh_token
```

### Refresh Response
```json
{
  "access_token": "ya29.new_access_token",
  "expires_in": 3599,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/contacts"
}
```

**No `refresh_token` in the response** — the original refresh_token must be preserved in the blob.

### What to Persist After Refresh
```typescript
const newBlob = {
  access_token: refreshData.access_token,
  refresh_token: originalRefreshToken,  // unchanged
  google_email: existingGoogleEmail,    // unchanged — preserve from current blob
}
const newExpiry = Date.now() + refreshData.expires_in * 1000

await ctx.supabase
  .from('integrations')
  .update({
    encrypted_api_key: await encrypt(JSON.stringify(newBlob)),
    config: { token_expiry: newExpiry, google_email: existingGoogleEmail } as Json,
  })
  .eq('organization_id', ctx.organizationId)
  .eq('provider', 'google_contacts')
```

Use `.eq('organization_id').eq('provider')` rather than `.eq('id')` since `resolveGoogleCredentials` may not expose the internal row ID. Alternatively, fetch the row ID in `resolveGoogleCredentials` and return it alongside the tokens so `callWithRefresh` can target by ID — this is cleaner and avoids a compound filter.

---

## Common Pitfalls

### Pitfall 1: Missing etag on updateContact
**What goes wrong:** HTTP 400 `failedPrecondition` from Google API
**Why it happens:** `updateContact` requires the `etag` from the current person to prevent race conditions
**How to avoid:** Use the `etag` returned in the `searchContacts` results — it is included in the search response and can be passed directly to the PATCH body without a separate GET call
**Warning signs:** 400 response with `failedPrecondition` reason code in the error JSON

### Pitfall 2: Using displayName as input (create/update)
**What goes wrong:** Contact is created without a name — Google ignores the `displayName` field in the request body
**Why it happens:** `displayName` is output-only (computed by Google). The correct input fields are `givenName` and `familyName`
**How to avoid:** Always split the flat `name` param into `{ givenName, familyName }` before sending to the API
**Warning signs:** Contact appears in Google Contacts with no name despite name being passed

### Pitfall 3: Refresh token not preserved on token refresh
**What goes wrong:** Next token refresh fails with "invalid_grant" — the refresh token was overwritten with undefined
**Why it happens:** Google's refresh response does NOT include a new refresh_token; if the code tries to store the response's `refresh_token` (which is undefined), the blob loses the original
**How to avoid:** Explicitly keep the original `refresh_token` when building the new encrypted blob after refresh

### Pitfall 4: action_type TypeScript exhaustiveness error before enum update
**What goes wrong:** TypeScript error "Type '...' is not assignable to type 'never'" in the default case
**Why it happens:** Once `database.ts` is updated with 4 new `action_type` values, TypeScript requires all enum members to have explicit cases
**How to avoid:** Update `execute-action.ts` with the 4 new cases IN THE SAME COMMIT as the `database.ts` update. Do not update `database.ts` without also adding the switch cases.

### Pitfall 5: searchContacts warmup omitted
**What goes wrong:** Search returns stale or empty results for recently created contacts
**Why it happens:** Google uses a lazy cache for `searchContacts` that requires a warmup request with empty query to refresh
**How to avoid:** Send a warmup `GET .../people:searchContacts?query=&readMask=names` before the real search. Accept that this doubles the API calls per find/update/delete. Since this is only for action engine calls (not high-frequency UI queries), the overhead is acceptable.

### Pitfall 6: No `google_contacts` integration row → unhandled null
**What goes wrong:** `credentials.ts` returns null → executor crashes with null dereference
**Why it happens:** Org has not connected Google Contacts
**How to avoid:** `resolveGoogleCredentials` must throw the D-05 error message before returning. The action engine's existing catch block in the Vapi tools route / ManyChat dispatch handler will catch this and log it as a failed action.

---

## Code Examples

### credentials.ts: resolveGoogleCredentials

```typescript
// Source: D-06, D-07 decisions + execute-action.ts ActionContext interface
import type { ActionContext } from '@/lib/action-engine/execute-action'
import { decrypt } from '@/lib/crypto'

export interface GoogleOAuthTokens {
  access_token: string
  refresh_token: string
  google_email?: string
  integrationId: string  // row.id — needed for targeted update on refresh
}

export async function resolveGoogleCredentials(
  ctx: ActionContext
): Promise<GoogleOAuthTokens> {
  const { data: row, error } = await ctx.supabase
    .from('integrations')
    .select('id, encrypted_api_key')
    .eq('organization_id', ctx.organizationId)
    .eq('provider', 'google_contacts')
    .single()

  if (error || !row) {
    throw new Error('Google Contacts not connected for this org. Connect via /integrations.')
  }

  const blob = JSON.parse(await decrypt(row.encrypted_api_key)) as {
    access_token: string
    refresh_token: string
    google_email?: string
  }

  return {
    access_token: blob.access_token,
    refresh_token: blob.refresh_token,
    google_email: blob.google_email,
    integrationId: row.id,
  }
}
```

### find-contact.ts: People API searchContacts call

```typescript
// Source: official docs + D-03, D-04 decisions
export async function findGoogleContact(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  const tokens = await resolveGoogleCredentials(ctx)
  const query = String(params.email ?? params.phone ?? '')

  if (!query) throw new Error('find_contact requires email or phone param')

  const url = new URL('https://people.googleapis.com/v1/people:searchContacts')
  url.searchParams.set('query', query)
  url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers')
  url.searchParams.set('pageSize', '10')

  const res = await callWithRefresh(
    tokens.access_token, tokens.refresh_token, tokens.integrationId, ctx,
    (token) => fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  )

  if (!res.ok) throw new Error(`People API error ${res.status}`)

  const data = await res.json() as { results?: Array<{ person: GooglePerson }> }
  const results = data.results ?? []

  if (results.length === 0) return 'No contact found matching that query.'

  const person = results[0].person
  const displayName = person.names?.[0]?.displayName ?? ''
  const email = person.emailAddresses?.[0]?.value ?? ''
  const phone = person.phoneNumbers?.[0]?.value ?? ''

  const parts = [displayName, email, phone].filter(Boolean)
  const summary = parts.join(' | ')
  const suffix = results.length > 1 ? ` (1 of ${results.length} matches)` : ''
  return `Found: ${summary}${suffix}`
}
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts) |
| Config file | `vitest.config.ts` at project root |
| Quick run command | `npx vitest run tests/google-contacts-executors.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACTIONS-01 | createGoogleContact calls POST people:createContact with correct body | unit | `npx vitest run tests/google-contacts-executors.test.ts` | ❌ Wave 0 |
| ACTIONS-01 | createGoogleContact returns single-line string with resourceName | unit | same | ❌ Wave 0 |
| ACTIONS-01 | createGoogleContact splits `name` into givenName/familyName | unit | same | ❌ Wave 0 |
| ACTIONS-02 | updateGoogleContact calls searchContacts first then PATCH | unit | same | ❌ Wave 0 |
| ACTIONS-02 | updateGoogleContact throws 'Contact not found for update' when search returns empty | unit | same | ❌ Wave 0 |
| ACTIONS-02 | updateGoogleContact includes etag in PATCH body | unit | same | ❌ Wave 0 |
| ACTIONS-02 | updateGoogleContact builds updatePersonFields mask from provided params only | unit | same | ❌ Wave 0 |
| ACTIONS-03 | findGoogleContact returns single-line 'Found: ...' string | unit | same | ❌ Wave 0 |
| ACTIONS-03 | findGoogleContact returns 'No contact found...' when results empty | unit | same | ❌ Wave 0 |
| ACTIONS-03 | findGoogleContact includes '(1 of N matches)' on multiple results | unit | same | ❌ Wave 0 |
| ACTIONS-04 | deleteGoogleContact calls searchContacts then DELETE | unit | same | ❌ Wave 0 |
| ACTIONS-04 | deleteGoogleContact throws 'Contact not found for delete' when search returns empty | unit | same | ❌ Wave 0 |
| All | resolveGoogleCredentials throws D-05 error when no integration row | unit | same | ❌ Wave 0 |
| All | callWithRefresh retries with new token on 401 response | unit | same | ❌ Wave 0 |
| All | callWithRefresh persists refreshed token to integrations row | unit | same | ❌ Wave 0 |
| All | executeAction dispatcher routes google_contacts_* to correct executor | unit | `npx vitest run tests/action-engine.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/google-contacts-executors.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/google-contacts-executors.test.ts` — covers ACTIONS-01 through ACTIONS-04, credential resolution, token refresh

*(Existing `tests/action-engine.test.ts` will need extending with the 4 new dispatcher cases — this is part of the plan, not a separate gap file.)*

### RED Test Stub Pattern (from this codebase)

The established pattern in this codebase (see `tests/google-oauth-actions.test.ts`, `tests/ghl-executor.test.ts`) is:

1. `vi.stubGlobal('fetch', mockFetch)` at top — mock global fetch before any imports
2. `vi.doMock(...)` inside individual tests when module-level mocking needs reset (or `vi.mock()` at top with `vi.resetModules()` in `beforeEach`)
3. Test structure: one `describe` per executor, 3-5 `it` blocks covering: (a) correct fetch call shape, (b) correct return string, (c) error path / not-found path
4. RED stubs use `it.todo('description')` for behaviors not yet implemented, OR full `it('...', async () => { ... })` tests that import the (not-yet-existing) module and assert on it — the latter forces the test to fail red on module-not-found

For this phase, the pattern from `tests/google-oauth-actions.test.ts` shows `it.todo()` is acceptable for Wave 0 stubs. The `tests/ghl-executor.test.ts` shows the full mock-fetch pattern for executor tests.

**Recommended test file structure for `tests/google-contacts-executors.test.ts`:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock crypto
vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn().mockResolvedValue('iv:ct'),
  decrypt: vi.fn().mockResolvedValue(
    JSON.stringify({ access_token: 'tok', refresh_token: 'ref', google_email: 'x@g.com' })
  ),
}))

// Mock Supabase client in ctx
function buildMockCtx(integrationRow: unknown = { id: 'int-1', encrypted_api_key: 'iv:ct' }) {
  const singleMock = vi.fn().mockResolvedValue({ data: integrationRow, error: null })
  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      single: singleMock,
    }),
  }
  return { organizationId: 'org-1', supabase } as unknown as ActionContext
}

describe('ACTIONS-01: createGoogleContact', () => {
  it.todo('calls POST people.googleapis.com/v1/people:createContact with correct body')
  it.todo('splits name param into givenName and familyName')
  it.todo('returns single-line string containing resourceName')
  it.todo('throws People API error on non-2xx response')
})

describe('ACTIONS-02: updateGoogleContact', () => {
  it.todo('calls searchContacts then PATCH updateContact with etag from search result')
  it.todo('builds updatePersonFields mask from only the provided params')
  it.todo("throws 'Contact not found for update' when searchContacts returns empty results")
})

describe('ACTIONS-03: findGoogleContact', () => {
  it.todo("returns 'Found: displayName | email | phone' when contact found")
  it.todo("returns 'No contact found matching that query.' when results empty")
  it.todo("includes '(1 of N matches)' suffix when multiple results returned")
  it.todo("omits absent fields from the Found: summary")
})

describe('ACTIONS-04: deleteGoogleContact', () => {
  it.todo('calls searchContacts then DELETE deleteContact with resourceName')
  it.todo("throws 'Contact not found for delete' when searchContacts returns empty results")
  it.todo('returns single-line success string on DELETE success')
})

describe('resolveGoogleCredentials: no-integration guard', () => {
  it.todo("throws 'Google Contacts not connected for this org...' when no integrations row")
})

describe('callWithRefresh: token refresh on 401', () => {
  it.todo('retries with new access_token when first API call returns 401')
  it.todo('persists new encrypted token blob to integrations row after successful refresh')
  it.todo('throws when token refresh itself fails (non-2xx from oauth2.googleapis.com/token)')
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Google Contacts API (v3) | People API (v1) | 2016 | Old API deprecated; People API is the only supported path |
| `connections.list` for search | `searchContacts` for query-based lookup | Added ~2020 | `searchContacts` is 10-30x faster for email/phone lookup; `connections.list` requires paginating all contacts |
| googleapis npm SDK | Native fetch | Team decision | No SDK used in this codebase — consistent with GHL executor pattern |

---

## Open Questions

1. **Name splitting for multi-word surnames**
   - What we know: `name = "João Silva"` → `givenName: "João"`, `familyName: "Silva"` — straightforward
   - What's unclear: `name = "Maria das Graças Oliveira"` — split at first word only? Split at last word?
   - Recommendation: Split at first whitespace for simplicity (`split(/\s+/, 2)`): `givenName = "Maria"`, `familyName = "das Graças Oliveira"`. This matches common Brazilian naming conventions where givenName is the first word. Alternatively, send the whole name as `givenName` only for single-word contacts.

2. **searchContacts warmup overhead**
   - What we know: Google recommends a warmup request before searches
   - What's unclear: Whether this causes user-visible latency or can be skipped for server-side action engine calls
   - Recommendation: Skip warmup for the initial implementation. If find/update/delete tests return stale data in integration testing, add warmup as a pre-call step.

3. **etag from searchContacts vs separate GET**
   - What we know: `searchContacts` returns `person.etag` in the result — this same etag can be used in `updateContact`
   - What's unclear: Whether the etag from a search result is always current enough (cache lag)
   - Recommendation: Use `searchContacts` etag directly for the PATCH (saves one API call). If 400 `failedPrecondition` appears in testing, add a fallback GET to fetch fresh etag.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| GOOGLE_CLIENT_ID env var | `callWithRefresh` token refresh | Unknown — set in Vercel env | — | Error thrown at refresh time if missing |
| GOOGLE_CLIENT_SECRET env var | `callWithRefresh` token refresh | Unknown — set in Vercel env | — | Error thrown at refresh time if missing |
| ENCRYPTION_SECRET env var | `encrypt`/`decrypt` in crypto.ts | Set (existing — used by all credential storage) | — | — |
| People API endpoint | All 4 executors | ✓ (public Google API, no local setup) | v1 | — |
| Supabase (integrations table with google_contacts row) | `resolveGoogleCredentials` | Requires Phase 27 complete + connected org | — | Returns D-05 error gracefully |

**Missing dependencies with no fallback:**
- A Google account must be connected (Phase 27 OAuth flow completed) before executors can run. This is by design — covered by D-05 error handling.

**Missing dependencies with fallback:**
- None.

---

## Sources

### Primary (HIGH confidence)
- [Google People API — createContact](https://developers.google.com/people/api/rest/v1/people/createContact) — request body, response schema, singleton field constraint
- [Google People API — updateContact](https://developers.google.com/people/api/rest/v1/people/updateContact) — PATCH URL, etag requirement, updatePersonFields mask
- [Google People API — deleteContact](https://developers.google.com/people/api/rest/v1/people/deleteContact) — DELETE URL, empty response
- [Google People API — searchContacts](https://developers.google.com/people/api/rest/v1/people/searchContacts) — GET URL, readMask, warmup requirement
- [Google OAuth 2.0 — Refreshing tokens](https://developers.google.com/identity/protocols/oauth2/web-server#offline) — refresh endpoint, request body, response (no new refresh_token)
- [Read and Manage Contacts guide](https://developers.google.com/people/v1/contacts) — full create/update examples including name field structure

### Secondary (MEDIUM confidence)
- [Google People API CRUD — Node.js GitHub](https://github.com/imzeeshan-dev/google-people-api-crud) — confirmed givenName/familyName pattern, etag in update body
- [Google API Python client etag issue #2417](https://github.com/googleapis/google-api-python-client/issues/2417) — confirmed etag required for updateContact

### Tertiary (LOW confidence)
- WebSearch results on warmup request requirement — single official source, behavior may vary in practice

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — native fetch is used throughout the codebase; People API endpoints verified against official docs
- Architecture: HIGH — executor pattern from GHL executors is directly applicable; ActionContext already supports DB access
- Field mapping: HIGH — confirmed givenName/familyName (not displayName) via official docs + code examples
- etag requirement: HIGH — confirmed by official docs + multiple GitHub issues
- Token refresh: HIGH — confirmed by official OAuth 2.0 docs; refresh_token not returned in refresh response
- Pitfalls: HIGH — all derived from verified API behavior
- Test patterns: HIGH — verified against existing test files in this codebase

**Research date:** 2026-05-07
**Valid until:** 2026-08-07 (Google People API is stable; token refresh pattern is long-lived)

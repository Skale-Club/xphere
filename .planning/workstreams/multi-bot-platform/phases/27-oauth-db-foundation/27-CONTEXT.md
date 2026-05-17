# Phase 27: OAuth + DB Foundation - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement Google OAuth 2.0 flow per org — admin initiates OAuth, Google redirects back, tokens are stored encrypted in the existing `integrations` table. Includes DB migration to extend the `integration_provider` enum and disconnect action.

</domain>

<decisions>
## Implementation Decisions

### Google OAuth App Credentials
- **D-01:** Use env vars `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — consistent with current Meta pattern (`META_APP_ID`/`META_APP_SECRET`). Move to platform_settings in a future milestone.

### Token Storage (existing `integrations` table)
- **D-02:** `encrypted_api_key` → AES-256-GCM encrypted JSON blob: `{ access_token, refresh_token }`
- **D-03:** `config` JSONB → non-sensitive metadata: `{ token_expiry: string, google_email: string }`
- **D-04:** `key_hint` → Google account email (unencrypted, used for display in UI)
- **D-05:** `provider` = `'google_contacts'` (new enum value via migration)
- **D-06:** One Google account per org — `UNIQUE(organization_id, provider)` already enforced by existing schema

### OAuth Flow Pattern
- **D-07:** Follow Meta OAuth pattern exactly: server action `connectGoogleContacts` → CSRF cookie → redirect to Google consent → callback route `/api/google/callback` → encrypt + upsert → redirect to `/integrations/google-contacts?connected=true`
- **D-08:** OAuth scope: `https://www.googleapis.com/auth/contacts`
- **D-09:** Callback route resolves `org_id` from authenticated session via `supabase.rpc('get_current_org_id')` — never trusts org from request params
- **D-10:** CSRF state cookie: `google_oauth_state`, 10-min TTL, httpOnly + sameSite=lax

### Disconnect
- **D-11:** Delete the `integrations` row for `provider = 'google_contacts'` for the current org — same pattern as other integrations

### Claude's Discretion
- Token payload JSON structure within `encrypted_api_key`
- Error redirect paths (mirror Meta: `?error=missing_code`, `?error=csrf`, `?error=no_org`, `?error=oauth_exchange`)
- Exact file structure for `src/lib/google-contacts/`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Meta OAuth Reference Implementation
- `src/lib/meta/oauth.ts` — OAuth URL builder, token exchange, API calls pattern
- `src/app/api/meta/callback/route.ts` — Full callback handler (CSRF check, token exchange, encrypt, upsert)
- `src/app/(dashboard)/integrations/meta/actions.ts` — `connectMeta` server action (CSRF cookie + redirect)

### Encryption
- `src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt (do not change format)

### Database
- `src/types/database.ts` — `integrations` table schema (lines 162–206), `integration_provider` enum (line 1093)
- `supabase/migrations/` — add new migration (028) to extend enum

### Auth Pattern
- `src/lib/supabase/server.ts` — `createClient`, `getUser` cached helpers

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/crypto.ts` — encrypt/decrypt, used as-is
- `src/lib/supabase/server.ts` — `createClient()`, `getUser()` — use cached helpers
- `src/lib/meta/oauth.ts` — template for `src/lib/google-contacts/oauth.ts`
- `src/app/api/meta/callback/route.ts` — template for `src/app/api/google/callback/route.ts`
- `src/app/(dashboard)/integrations/meta/actions.ts` — template for Google connect/disconnect actions

### Established Patterns
- CSRF state: `crypto.randomUUID()` → cookie → verify in callback
- Credentials: encrypt JSON blob → store in `encrypted_api_key`; metadata → `config` JSONB
- Org resolution: `supabase.rpc('get_current_org_id')` in callback (never from request body)
- Always redirect (never JSON response) from OAuth callback routes

### Integration Points
- `integrations` table: upsert with `onConflict: 'organization_id,provider'`
- `integration_provider` enum: requires migration 028 to add `google_contacts`
- New env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (add to `.env.local` and `.env.local.example`)

</code_context>

<specifics>
## Specific Ideas

- Google OAuth redirect URI: `https://operator.skale.club/api/google/callback`
- Token refresh is NOT in scope for Phase 27 — handled in Phase 28 (action executors)

</specifics>

<deferred>
## Deferred Ideas

- Move `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to platform_settings — future milestone
- Token refresh background job — Phase 28 concern
- Multiple Google accounts per org — Future Requirements in REQUIREMENTS.md

</deferred>

---

*Phase: 27-oauth-db-foundation*
*Context gathered: 2026-05-06*

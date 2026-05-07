# Phase 28: Action Executors - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Add 4 new `action_type` enum values (`google_contacts_create`, `google_contacts_update`, `google_contacts_find`, `google_contacts_delete`) via DB migration, implement 4 Google People API executors in `src/lib/google-contacts/`, and wire them into the `executeAction` dispatcher. No UI. No ManyChat-specific wiring — the existing action engine dispatch handles routing.

</domain>

<decisions>
## Implementation Decisions

### Token Refresh Strategy
- **D-01:** Refresh-on-401 pattern — call People API with current `access_token`; if response is 401, use `refresh_token` to obtain a new `access_token` from Google token endpoint (`https://oauth2.googleapis.com/token`), persist the updated encrypted blob and new `token_expiry` to the `integrations` row, then retry the original API call once. If the refresh itself fails, throw with a clear message.
- **D-02:** Token persistence on refresh: update `encrypted_api_key` (new AES-256-GCM blob of `{ access_token, refresh_token }`) and `config.token_expiry` in the `integrations` row for the org. The executor receives `organizationId + supabase` via `ActionContext` — use these to fetch and persist.

### `find` Result Format
- **D-03:** Return a single-line summary string consistent with all existing executors (no newlines — Vapi parser breaks on `\n`):
  - Match found: `"Found: {displayName} | {emailAddress} | {phoneNumber}"` — omit absent fields
  - No match: `"No contact found matching that query."`
  - Multiple matches: return the first result with a note: `"Found: {displayName} | {email} (1 of {N} matches)"`
- **D-04:** `find` searches by email OR phone (whichever is provided in params) using the People API `people.searchContacts` endpoint with the value as the query string.

### No-Integration Error
- **D-05:** When no `integrations` row exists for `provider = 'google_contacts'` for the current org, throw: `new Error('Google Contacts not connected for this org. Connect via /integrations.')` — the action engine catches, logs as failed, returns the error string to the caller. Does NOT crash the engine.

### Executor Architecture
- **D-06:** Add a new `resolveGoogleCredentials(ctx: ActionContext): Promise<GoogleOAuthTokens>` helper in `src/lib/google-contacts/credentials.ts` — fetches the `integrations` row, decrypts `encrypted_api_key`, returns `{ access_token, refresh_token, token_expiry }`. This keeps credential resolution out of each executor.
- **D-07:** Each executor calls `resolveGoogleCredentials`, then calls the People API. Token refresh logic lives inside `resolveGoogleCredentials` (or a wrapper `callWithRefresh`).
- **D-08:** The `executeAction` dispatcher passes the existing `ActionContext` (`organizationId + supabase`) to google_contacts cases. `GhlCredentials` is not needed for these cases — the switch branch calls executors without it.
- **D-09:** 4 executor files under `src/lib/google-contacts/`: `create-contact.ts`, `update-contact.ts`, `find-contact.ts`, `delete-contact.ts`.

### DB Migration
- **D-10:** New migration (029) adds 4 values to the `action_type` enum: `google_contacts_create`, `google_contacts_update`, `google_contacts_find`, `google_contacts_delete`. Update `src/types/database.ts` after migration.

### Field Mapping (create/update)
- **D-11:** Standard fields per ROADMAP: `name` (full name → `displayName`), `email`, `phone`, `company` (→ `organizations[0].name`), `notes` (→ `biographies[0].value`). Params keys follow the same flat-object convention as existing GHL executors.
- **D-12:** `update` locates the contact by email first (`find` logic), then calls `people.updateContact` with the `resourceName`. If not found, throw: `new Error('Contact not found for update: {email}')`.
- **D-13:** `delete` locates by email, calls `people.deleteContact`. If not found, throw: `new Error('Contact not found for delete: {email}')`.

### Claude's Discretion
- People API pagination handling in `find` (return first result only)
- Exact URL construction for People API calls (use `https://people.googleapis.com/v1/`)
- `updatePersonFields` mask construction for `update` (include only fields present in params)
- `readMask` selection for `connections.list` responses

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Action Engine
- `src/lib/action-engine/execute-action.ts` — dispatcher to extend with google_contacts cases (lines 1–50)
- `src/lib/ghl/create-contact.ts` — executor pattern reference: params typing, single-line return string

### Google OAuth / Credentials
- `src/lib/google-contacts/oauth.ts` — existing utility: `GOOGLE_CALLBACK_URI`, `exchangeCodeForTokens`, `GoogleTokenResponse` type
- `src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt (do not change format)

### Database
- `src/types/database.ts` — `integrations` table schema (lines 162–206), `action_type` enum (line 1092), `integration_provider` enum (line 1093)
- `supabase/migrations/` — add migration 029 for new enum values

### Auth / Supabase
- `src/lib/supabase/server.ts` — `createClient`, `getUser` cached helpers

### Google People API
- Endpoint: `https://people.googleapis.com/v1/people:searchContacts` — for find
- Endpoint: `https://people.googleapis.com/v1/people` — for create (`POST`)
- Endpoint: `https://people.googleapis.com/v1/{resourceName}:updateContact` — for update (`PATCH`)
- Endpoint: `https://people.googleapis.com/v1/{resourceName}:deleteContact` — for delete (`DELETE`)

### Phase 27 Context
- `.planning/phases/27-oauth-db-foundation/27-CONTEXT.md` — token storage decisions (D-02 through D-06)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/crypto.ts` — `encrypt` / `decrypt` used as-is for token blob
- `src/lib/google-contacts/oauth.ts` — `GoogleTokenResponse` type, env var pattern
- `src/lib/action-engine/execute-action.ts` — dispatcher to extend (new cases in switch)
- `src/lib/ghl/create-contact.ts` — executor template: params interface + single-line return string

### Established Patterns
- Executors return plain `string` (no newlines for Vapi compat)
- `ActionContext` (`organizationId + supabase`) already flows into executors that need DB access (see `knowledge_base` case)
- Encrypted credentials fetched from `integrations` table by `provider` + `organizationId` — same pattern as GHL

### Integration Points
- `execute-action.ts` switch: add 4 new cases, each calling the corresponding executor with `ctx`
- `integrations` table: read row where `provider = 'google_contacts'` AND org matches; decrypt `encrypted_api_key`; update on refresh
- `action_type` enum: requires migration 029 before TypeScript types can be updated

</code_context>

<specifics>
## Specific Ideas

- Token refresh: update the `integrations` row in-place (same `upsert` pattern as Phase 27 callback)
- `find` single-line format: `"Found: João Silva | joao@example.com | +55 11 99999-9999"` — omit fields not returned by API
- Executors do NOT import from `src/lib/ghl/` — they're fully independent

</specifics>

<deferred>
## Deferred Ideas

- Batch operations (create/update/delete multiple contacts in one action call) — future requirement
- Token refresh as a background cron job (proactive before expiry) — future milestone
- Multiple Google accounts per org — Future Requirements in REQUIREMENTS.md
- Scopes beyond `contacts` (e.g., Calendar, Gmail) — separate integration phase

</deferred>

---

*Phase: 28-action-executors*
*Context gathered: 2026-05-07*

---
phase: 27-oauth-db-foundation
plan: 03
subsystem: api
tags: [google-oauth, oauth2, encryption, integrations, nextjs-route-handler]

# Dependency graph
requires:
  - phase: 27-01
    provides: google_contacts enum value added to integration_provider in database.ts
  - phase: 27-02
    provides: exchangeCodeForTokens, fetchGoogleUserEmail, GOOGLE_OAUTH_STATE_COOKIE exports in src/lib/google-contacts/oauth.ts
provides:
  - GET /api/google/callback — complete OAuth callback handler that closes the Google authorization code flow
  - CSRF state validation before any Google API call
  - AES-256-GCM encrypted token storage in integrations table
  - Upsert with onConflict organization_id,provider for safe reconnects
affects:
  - 28-action-executors (reads encrypted_api_key from integrations to call People API)
  - 29-dashboard-ui (redirect target /integrations/google-contacts?connected=true, error params)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Google OAuth callback mirrors Meta OAuth pattern: CSRF cookie → code exchange → encrypt → upsert → redirect"
    - "D-02: encrypted_api_key stores { access_token, refresh_token } only; config JSONB holds non-sensitive metadata"
    - "D-03: config JSONB = { token_expiry, google_email } — readable without decryption for UI display"

key-files:
  created: []
  modified:
    - src/app/api/google/callback/route.ts

key-decisions:
  - "Aligned redirect paths to locked decision D-07: /integrations/google-contacts?connected=true and ?error={reason} (not /integrations)"
  - "Encrypted blob contains only { access_token, refresh_token } per D-02; token_expiry and google_email moved to config JSONB per D-03"
  - "refresh_token absence on reconnect logged as warning, not error (Pitfall 2 from RESEARCH.md)"

patterns-established:
  - "Google OAuth callback: CSRF → exchange → encrypt → upsert pattern for future OAuth providers"

requirements-completed:
  - GCONTACTS-01

# Metrics
duration: 15min
completed: 2026-05-06
---

# Phase 27 Plan 03: Google OAuth Callback Route Summary

**GET /api/google/callback handler that validates CSRF state, exchanges Google authorization code, encrypts { access_token, refresh_token } with AES-256-GCM, and upserts into integrations table with config JSONB holding token_expiry and google_email**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-06T03:00:00Z
- **Completed:** 2026-05-06T03:15:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Verified callback route structure against all locked decisions (D-02 through D-10)
- Corrected token storage schema: moved token_expiry/google_email from encrypted blob to config JSONB per D-03
- Fixed redirect paths to match D-07 (`/integrations/google-contacts` not `/integrations`)
- Build passes cleanly with no TypeScript errors

## Task Commits

1. **Task 1: Implement /api/google/callback GET route handler** - `4967e1a` (feat)

**Plan metadata:** _(pending docs commit)_

## Files Created/Modified

- `src/app/api/google/callback/route.ts` — Complete Google OAuth callback: CSRF validation, code exchange, AES-256-GCM token encryption, integrations upsert, redirect handling

## Decisions Made

- Aligned encrypted blob to D-02 spec (`{ access_token, refresh_token }` only) — token_expiry and google_email belong in `config` per D-03 so they are readable without decryption
- Used `/integrations/google-contacts?connected=true` redirect per D-07 — the wave-1 implementation used `/integrations?google_connected=true` which would break Phase 29 dashboard UI

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected token storage layout to match locked decisions**
- **Found during:** Task 1 (verification of existing implementation)
- **Issue:** Wave-1 implementation stored `{ access_token, refresh_token, token_expiry, google_email }` in the encrypted blob and set `config: {}` empty. Plan D-02 specifies only `{ access_token, refresh_token }` encrypted; D-03 specifies `config = { token_expiry, google_email }` unencrypted.
- **Fix:** Moved token_expiry and google_email from encrypted blob to config JSONB. Encrypted blob now contains only `{ access_token, refresh_token }`.
- **Files modified:** src/app/api/google/callback/route.ts
- **Verification:** Build passes; grep checks confirm all patterns present
- **Committed in:** 4967e1a

**2. [Rule 1 - Bug] Fixed redirect paths to match D-07**
- **Found during:** Task 1 (verification of existing implementation)
- **Issue:** Wave-1 redirected to `/integrations?error=...` and `/integrations?google_connected=true`. D-07 specifies `/integrations/google-contacts?error=...` and `/integrations/google-contacts?connected=true`.
- **Fix:** Updated all redirect paths to use `/integrations/google-contacts` base and `connected=true` (not `google_connected=true`).
- **Files modified:** src/app/api/google/callback/route.ts
- **Verification:** Build passes; paths match D-07 spec
- **Committed in:** 4967e1a

---

**Total deviations:** 2 auto-fixed (2 correctness bugs in wave-1 implementation)
**Impact on plan:** Both fixes necessary to match locked decisions. Phase 29 dashboard UI depends on these redirect paths and config structure.

## Issues Encountered

None — build passed cleanly after corrections.

## Known Stubs

None — all data is wired. The route is fully functional pending GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env vars (documented as manual setup in Phase 27 context).

## Next Phase Readiness

- Callback route complete and aligned with all locked decisions (D-02 through D-10)
- Phase 28 can read encrypted_api_key from integrations table to call People API
- Phase 29 dashboard UI can use `/integrations/google-contacts?connected=true` redirect target
- Pending manual steps: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET env vars, Google Cloud Console OAuth app registration

---
*Phase: 27-oauth-db-foundation*
*Completed: 2026-05-06*

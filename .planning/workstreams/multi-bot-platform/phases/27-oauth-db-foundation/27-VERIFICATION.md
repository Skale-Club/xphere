---
phase: 27-oauth-db-foundation
verified: 2026-05-06T12:00:00Z
status: gaps_found
score: 8/10 must-haves verified
gaps:
  - truth: "Test stub files exist for google-oauth-actions and google-callback-route coverage"
    status: failed
    reason: "Neither tests/google-oauth-actions.test.ts nor tests/google-callback-route.test.ts exists in the repository"
    artifacts:
      - path: "tests/google-oauth-actions.test.ts"
        issue: "File does not exist"
      - path: "tests/google-callback-route.test.ts"
        issue: "File does not exist"
    missing:
      - "Create tests/google-oauth-actions.test.ts with it.todo stubs for GCONTACTS-01 (connectGoogleContacts) and GCONTACTS-02 (disconnectGoogleContacts) per plan 27-01 Task 2 specification"
      - "Create tests/google-callback-route.test.ts with it.todo stubs for GCONTACTS-01 callback flow (success and failure cases) per plan 27-01 Task 2 specification"
  - truth: "connectGoogleContacts and disconnectGoogleContacts are wired into a UI component"
    status: failed
    reason: "The server actions exist and are fully implemented but are not imported or used by any component yet. Phase 29 owns the UI — this is expected by the plans, but the actions are orphaned at this phase boundary."
    artifacts:
      - path: "src/app/(dashboard)/integrations/google-contacts/actions.ts"
        issue: "Not imported by any component (Phase 29 UI not yet built)"
    missing:
      - "No action required — this gap is deferred to Phase 29 by design. Noting for traceability."
human_verification:
  - test: "Run npm run build to confirm no TypeScript errors"
    expected: "Exit 0 with no TS errors from any of the new google-contacts files"
    why_human: "Cannot run build in this environment without starting a process"
  - test: "Push migration 028_google_contacts_foundation.sql to Supabase and confirm 'google_contacts' appears in integration_provider enum values"
    expected: "SELECT enum_range(NULL::public.integration_provider) returns array containing 'google_contacts'"
    why_human: "Requires live Supabase connection"
  - test: "Trigger /api/google/oauth in a browser and verify redirect to Google consent screen with access_type=offline in the URL"
    expected: "Browser lands on accounts.google.com with access_type=offline, client_id, redirect_uri, scope, and state query params"
    why_human: "Requires running Next.js server and Google OAuth app credentials in environment"
---

# Phase 27: OAuth + DB Foundation Verification Report

**Phase Goal:** Admins can connect a Google account per org via OAuth 2.0, with access and refresh tokens stored encrypted in the database
**Verified:** 2026-05-06
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | The integrations table accepts 'google_contacts' as a valid provider value | VERIFIED | `028_google_contacts_foundation.sql` contains `ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'google_contacts'` |
| 2  | TypeScript types in database.ts include 'google_contacts' in the integration_provider union | VERIFIED | Lines 166, 179, and 1093 of `src/types/database.ts` all include `'google_contacts'` in the provider union |
| 3  | Test stub files exist for google-oauth-actions and google-callback-route coverage | FAILED | Neither `tests/google-oauth-actions.test.ts` nor `tests/google-callback-route.test.ts` exists |
| 4  | buildGoogleOAuthUrl() returns a valid Google OAuth authorization URL with access_type=offline and all required parameters | VERIFIED | `src/lib/google-contacts/oauth.ts` line 39: `url.searchParams.set('access_type', 'offline')` — all required params set |
| 5  | exchangeCodeForTokens() POSTs to https://oauth2.googleapis.com/token with form-encoded body | VERIFIED | `oauth.ts` uses `URLSearchParams` body and `Content-Type: application/x-www-form-urlencoded` |
| 6  | fetchGoogleUserEmail() calls https://www.googleapis.com/oauth2/v2/userinfo with Bearer token | VERIFIED | `oauth.ts` lines 71-83 — correct endpoint and Authorization header |
| 7  | connectGoogleContacts() sets google_oauth_state cookie then redirects to Google consent URL | VERIFIED | `actions.ts` lines 38-41 — sets cookie with `httpOnly`, `sameSite: 'lax'`, `maxAge: 600`, then `redirect(buildGoogleOAuthUrl(state))` |
| 8  | disconnectGoogleContacts() deletes the integrations row for provider=google_contacts | VERIFIED | `actions.ts` lines 59-65 — `.delete().eq('organization_id', orgId).eq('provider', 'google_contacts')` |
| 9  | GET /api/google/callback validates CSRF state before any Google API call | VERIFIED | `callback/route.ts` lines 51-53 — state mismatch redirects to `?error=csrf` before `exchangeCodeForTokens` is called |
| 10 | Successful callback stores encrypted { access_token, refresh_token } in the integrations table under provider=google_contacts | VERIFIED | `callback/route.ts` line 75: `encrypt(JSON.stringify({ access_token, refresh_token }))`, upserted at line 79 |

**Score:** 8/10 truths verified (truth 3 failed; truth about UI wiring deferred to Phase 29 by design)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/028_google_contacts_foundation.sql` | ALTER TYPE adding google_contacts | VERIFIED | File exists; contains `ADD VALUE IF NOT EXISTS 'google_contacts'`. Note: PLAN 27-01 expected filename `028_google_contacts_provider.sql` — actual file is `028_google_contacts_foundation.sql`. Content is correct. |
| `src/types/database.ts` | 'google_contacts' in provider union at Row, Insert, Enums | VERIFIED | All 3 locations confirmed (lines 166, 179, 1093) |
| `src/lib/google-contacts/oauth.ts` | Exports buildGoogleOAuthUrl, exchangeCodeForTokens, fetchGoogleUserEmail, GOOGLE_OAUTH_STATE_COOKIE; includes access_type=offline | VERIFIED | All 4 exports present and access_type=offline set at line 39 |
| `src/app/(dashboard)/integrations/google-contacts/actions.ts` | Exports connectGoogleContacts and disconnectGoogleContacts | VERIFIED | Both server actions fully implemented |
| `src/app/api/google/oauth/route.ts` | Export runtime nodejs, set CSRF cookie | VERIFIED | `export const runtime = 'nodejs'`; sets `google_oauth_state` cookie and redirects to Google |
| `src/app/api/google/callback/route.ts` | Validate CSRF, call get_current_org_id(), encrypt token bundle, upsert with onConflict | VERIFIED | All four requirements confirmed in the file |
| `.env.local.example` | GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET entries | VERIFIED | Lines 33-34 confirmed |
| `tests/google-oauth-actions.test.ts` | it.todo stubs for GCONTACTS-01 connect and GCONTACTS-02 disconnect | MISSING | File does not exist |
| `tests/google-callback-route.test.ts` | it.todo stubs for GCONTACTS-01 callback flow | MISSING | File does not exist |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/app/(dashboard)/integrations/google-contacts/actions.ts` | `src/lib/google-contacts/oauth.ts` | `buildGoogleOAuthUrl` import | WIRED | Import at line 12; used at line 41 |
| `connectGoogleContacts` | `google_oauth_state cookie` | `cookies().set` with httpOnly + sameSite=lax + maxAge=600 | WIRED | `GOOGLE_OAUTH_STATE_COOKIE` constant used; all cookie options set |
| `src/app/api/google/callback/route.ts` | `src/lib/google-contacts/oauth.ts` | `exchangeCodeForTokens` + `fetchGoogleUserEmail` imports | WIRED | Both functions imported and called |
| `src/app/api/google/callback/route.ts` | `src/lib/crypto.ts` | `encrypt()` import | WIRED | `encrypt(JSON.stringify(...))` pattern at line 75 |
| `src/app/api/google/callback/route.ts` | integrations table | `supabase.from('integrations').upsert` with `onConflict: 'organization_id,provider'` | WIRED | Line 94 confirms `onConflict` constraint |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `callback/route.ts` | `tokens` (access_token, refresh_token) | `exchangeCodeForTokens(code)` — live fetch to Google token endpoint | Yes — live OAuth exchange, not hardcoded | FLOWING |
| `callback/route.ts` | `googleEmail` | `fetchGoogleUserEmail(tokens.access_token)` — live fetch to Google userinfo | Yes — live API call | FLOWING |
| `callback/route.ts` | `encryptedBlob` | `encrypt(JSON.stringify({access_token, refresh_token}))` — AES-256-GCM via `src/lib/crypto.ts` | Yes — real encryption of real tokens | FLOWING |
| `callback/route.ts` | upserted row | `supabase.from('integrations').upsert(...)` | Yes — real DB write | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| oauth.ts exports all required symbols | `grep -n "^export" src/lib/google-contacts/oauth.ts` | GOOGLE_CALLBACK_PATH, GOOGLE_CALLBACK_URI, GOOGLE_OAUTH_STATE_COOKIE, GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS, GOOGLE_OAUTH_SCOPE, GoogleTokenResponse, buildGoogleOAuthUrl, exchangeCodeForTokens, fetchGoogleUserEmail | PASS |
| access_type=offline in URL builder | `grep "access_type.*offline" src/lib/google-contacts/oauth.ts` | Line 39 — confirmed | PASS |
| CSRF validation precedes Google API call | Review of route.ts control flow | State cookie check at lines 51-53 occurs before `exchangeCodeForTokens` at line 64 | PASS |
| onConflict uses correct column pair | `grep "onConflict.*organization_id,provider" callback/route.ts` | Line 94 — confirmed | PASS |
| Test stub files exist | `ls tests/google-*.test.ts` | No output — files absent | FAIL |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|-------------|-------------|--------|----------|
| GCONTACTS-01 | Plans 27-01, 27-02, 27-03 | Admin can connect a Google account via OAuth (Google OAuth 2.0 per org, stored encrypted via AES-256-GCM) | SATISFIED | Migration extends enum; oauth.ts builds auth URL; callback route exchanges code, encrypts tokens with AES-256-GCM, upserts to integrations table |
| GCONTACTS-02 | Plans 27-01, 27-02 | Admin can disconnect the Google account integration | SATISFIED | `disconnectGoogleContacts` in actions.ts deletes the integrations row for `provider='google_contacts'` for the active org |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/(dashboard)/integrations/google-contacts/actions.ts` | — | `connectGoogleContacts` and `disconnectGoogleContacts` not imported by any component | Info | Actions orphaned at this phase boundary — deferred to Phase 29 by design. Not a blocker. |
| `supabase/migrations/028_google_contacts_foundation.sql` | — | Migration filename differs from PLAN 27-01 expected name (`028_google_contacts_provider.sql` vs actual `028_google_contacts_foundation.sql`) | Info | Content is correct; filename discrepancy has no runtime impact. |

No blocking anti-patterns detected. No TODO/FIXME/placeholder comments in any modified file. No empty return stubs. All implementations are substantive.

---

## Human Verification Required

### 1. TypeScript Build

**Test:** Run `npm run build` from project root
**Expected:** Exit 0 with no TypeScript errors from any of the new google-contacts files
**Why human:** Cannot start build process in this verification environment

### 2. Migration Applied to Supabase

**Test:** After running `npx supabase db push`, query `SELECT enum_range(NULL::public.integration_provider)` in Supabase SQL editor
**Expected:** Array includes `'google_contacts'`
**Why human:** Requires live Supabase connection and credentials

### 3. End-to-End OAuth Initiation

**Test:** Navigate to `/api/google/oauth` in a browser with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set
**Expected:** Browser redirects to `https://accounts.google.com/o/oauth2/v2/auth` with `access_type=offline`, `scope=https://www.googleapis.com/auth/contacts`, `client_id`, `redirect_uri=https://operator.skale.club/api/google/callback`, and a `state` parameter
**Why human:** Requires running Next.js server and Google OAuth app configured in Google Cloud Console

---

## Gaps Summary

One gap blocks the plan 27-01 completeness contract: the test stub files (`tests/google-oauth-actions.test.ts` and `tests/google-callback-route.test.ts`) were specified in Plan 27-01 Task 2 and do not exist in the repository. These are `it.todo` stub files — they contain no actual test implementations, only behavioral contracts. Their absence does not affect runtime functionality or the core phase goal (OAuth connect/disconnect with encrypted storage), but the plan defined them as must-have artifacts.

The core phase goal — "Admins can connect a Google account per org via OAuth 2.0, with access and refresh tokens stored encrypted in the database" — is fully achieved by the existing implementation. GCONTACTS-01 and GCONTACTS-02 are satisfied. The missing test stubs are a documentation/contract gap, not a functional gap.

---

_Verified: 2026-05-06_
_Verifier: Claude (gsd-verifier)_

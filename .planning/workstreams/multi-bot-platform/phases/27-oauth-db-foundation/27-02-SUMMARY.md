---
phase: 27-oauth-db-foundation
plan: 02
subsystem: auth
tags: [google-oauth, oauth2, server-actions, supabase, integrations]

# Dependency graph
requires:
  - phase: 27-oauth-db-foundation plan 01
    provides: "integration_provider enum with google_contacts value in DB"
provides:
  - "src/lib/google-contacts/oauth.ts: buildGoogleOAuthUrl, exchangeCodeForTokens, fetchGoogleUserEmail, GOOGLE_CALLBACK_URI, GOOGLE_OAUTH_STATE_COOKIE"
  - "src/app/(dashboard)/integrations/google-contacts/actions.ts: connectGoogleContacts, disconnectGoogleContacts server actions"
  - "google_contacts added to integration_provider TypeScript union types"
affects: [27-03, 28-action-executors, 29-dashboard-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [google-oauth-server-action, csrf-state-cookie-redirect, form-encoded-token-exchange]

key-files:
  created:
    - src/lib/google-contacts/oauth.ts
    - src/app/(dashboard)/integrations/google-contacts/actions.ts
  modified:
    - src/types/database.ts
    - src/app/(dashboard)/integrations/actions.ts
    - src/components/integrations/integration-form.tsx
    - .env.local.example

key-decisions:
  - "access_type=offline is mandatory in buildGoogleOAuthUrl — without it Google omits refresh_token"
  - "Token exchange body uses URLSearchParams (form-encoded), not JSON — Google API requirement"
  - "State cookie uses httpOnly + sameSite=lax + 600s maxAge (mirrors Meta OAuth pattern)"
  - "disconnectGoogleContacts deletes integrations row by provider=google_contacts (not by id)"

patterns-established:
  - "Google OAuth mirrors Meta OAuth pattern: constants → env guard → URL builder → token exchange → userinfo"
  - "Server action for OAuth initiation: getUser → rpc get_current_org_id → randomUUID state → cookie → redirect"

requirements-completed:
  - GCONTACTS-01
  - GCONTACTS-02

# Metrics
duration: 8min
completed: 2026-05-07
---

# Phase 27 Plan 02: Google OAuth Utility Module + Server Actions Summary

**Google OAuth URL builder, token exchange, and userinfo utilities plus connect/disconnect server actions using CSRF state cookie pattern mirroring Meta OAuth implementation**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-07T02:43:58Z
- **Completed:** 2026-05-07T02:51:27Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `src/lib/google-contacts/oauth.ts` — complete OAuth utility module with constants, URL builder (access_type=offline), form-encoded token exchange, and userinfo fetch
- `src/app/(dashboard)/integrations/google-contacts/actions.ts` — `connectGoogleContacts` (CSRF state + redirect) and `disconnectGoogleContacts` (delete integrations row) server actions
- TypeScript types updated: `google_contacts` added to `integration_provider` enum union across `database.ts`, `integrations/actions.ts`, and `integration-form.tsx`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/lib/google-contacts/oauth.ts** - `0d70702` (feat)
2. **Task 2: Create google-contacts server actions and update .env.local.example** - `02bd501` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/lib/google-contacts/oauth.ts` - Google OAuth constants, buildGoogleOAuthUrl, exchangeCodeForTokens, fetchGoogleUserEmail
- `src/app/(dashboard)/integrations/google-contacts/actions.ts` - connectGoogleContacts and disconnectGoogleContacts server actions
- `src/types/database.ts` - Added 'google_contacts' to integration_provider enum and integrations table Row/Insert types
- `src/app/(dashboard)/integrations/actions.ts` - Added 'google_contacts' to IntegrationForDisplay provider union
- `src/components/integrations/integration-form.tsx` - Added 'google_contacts': 'Google Contacts' to PROVIDER_LABELS map
- `.env.local.example` - Documented GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET

## Decisions Made
- Used exact Meta OAuth pattern — same constant naming convention, cookie options, and server action structure
- `access_type=offline` set explicitly in URL builder to guarantee refresh_token is returned on first grant
- Token exchange uses `URLSearchParams.toString()` as body (form-encoded) — JSON would fail with Google token endpoint
- `disconnectGoogleContacts` matches by `provider='google_contacts'` (not by id) since there is one Google connection per org

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript type union did not include 'google_contacts'**
- **Found during:** Task 2 (server actions creation)
- **Issue:** Build failed — `provider: 'google_contacts'` is not assignable to the existing union type in `database.ts`; also `IntegrationForDisplay` in `integrations/actions.ts` and `PROVIDER_LABELS` in `integration-form.tsx` lacked the new value
- **Fix:** Added `'google_contacts'` to the provider union in `database.ts` (Row, Insert, and Enums sections), `IntegrationForDisplay` in `integrations/actions.ts`, and `PROVIDER_LABELS` in `integration-form.tsx`
- **Files modified:** src/types/database.ts, src/app/(dashboard)/integrations/actions.ts, src/components/integrations/integration-form.tsx
- **Verification:** `npm run build` exits 0 with no type errors
- **Committed in:** 02bd501 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for build to pass. Plan 27-01 owns the DB migration + `database.ts` update but runs in parallel; this plan applied the TypeScript-only portion needed immediately to unblock the build.

## Issues Encountered
None beyond the type deviation above.

## User Setup Required
None — no external service configuration required in this plan. Environment variable documentation added to `.env.local.example`. Google Cloud Console setup is tracked in Plan 27-01's `user_setup` block.

## Next Phase Readiness
- OAuth utility module is ready for use by the callback route (Plan 27-03)
- Server actions are ready for use by the Phase 29 UI connect/disconnect buttons
- No blockers for parallel plan execution

---
*Phase: 27-oauth-db-foundation*
*Completed: 2026-05-07*

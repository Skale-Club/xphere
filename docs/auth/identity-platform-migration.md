# Migration: Supabase Auth to Google Identity Platform

Status: live since 2026-11-05; step 8 of the operations is still open. Xphere uses the sign-in Xpot already runs: a texted code first, Google as the
alternative, both through Identity Platform in the `skaleclub` Google Cloud project, with a session the
application owns. Passwords go away. Supabase stays as the database, Storage and Realtime.

There are no outside customers yet (only a handful of our own accounts plus the demo user), so this is a one-step cutover without a
period of running both sign-ins.

## The one real difference from Xpot

Xpot authorizes in its Express code, so it could drop Supabase outright. Xphere authorizes in the database:
RLS policies and `get_current_org_id()` read `auth.uid()`, which is only `current_setting('request.jwt.claims')->>'sub'`
cast to uuid. Firebase UIDs are not UUIDs, so Supabase's Firebase third-party auth cannot be used as it stands.

Xpeed does use that integration, after replacing `auth.uid()` with a mapping function in its policies. That fits Xpeed because
its browser holds the Firebase token for every query. Xphere renders on the server through 254 files that call `getUser()`, and a
server has no Firebase token to send unless the browser's refreshable login is moved into a cookie, which is the second login Xpot's design avoids.
It would also mean rewriting 37 policies and 11 functions that read `auth.uid()` directly.

So the database keeps trusting only Supabase-issued tokens, and the server fetches one per user. This is a temporary bridge: the
database leaves Supabase soon, and the bridge goes with it. The sign-in never touches Supabase Auth, and the user never sees the bridge.

```
Firebase ID token -> POST /api/auth/identity -> app session (opaque cookie, row in app_sessions)
                                                     |
                     getUser() reads the session     |   createClient() asks supabase-jwt.ts for a token:
                                                     v   admin.generateLink(magiclink, email)   (service role, no email sent)
                                                         -> verifyOtp(token_hash) -> access_token, 1 hour
                                              PostgREST, Storage and Realtime accept it as an ordinary `authenticated` user
```

Every account therefore keeps a shadow row in `auth.users` (no password, same id as `public.users`); the token's `sub` is that id.
Tokens are cached per user and reused until 5 minutes remain, concurrent requests share one fetch, and each fetched session is
logged out locally so `auth.sessions` does not grow. The service role key is the only secret the bridge needs; no signing key is imported.

The user ids do not change, so no RLS policy changes and all data keeps its owner.

## Database (migration 1336)

Additive, idempotent, applied with `npx supabase db push`.

- `public.users`: `id uuid` (same ids as `auth.users`), `email`, `phone` (E.164, unique), `user_metadata jsonb`
  (copied from `raw_user_meta_data`, so `user.user_metadata.full_name` keeps working), `last_sign_in_at`, timestamps.
  Backfilled from `auth.users`. RLS: a user reads their own row; only the service role writes.
- `public.auth_google_identities (project_id, subject, user_id)`: same as Xpot migration 0079. Service role only.
- `public.app_sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip)`. Service role only.
- All 83 foreign keys to `auth.users` are recreated against `public.users`, keeping each `ON DELETE` rule, by a loop over `pg_constraint`.
- `get_org_member_profiles` reads `public.users`. It is the only function that reads `auth.users`; no policy or view does.

`auth.users` keeps its rows, so a rollback only needs the old code. The one write to it repairs NULL token columns
(`confirmation_token`, `recovery_token`, `email_change*`, `phone_change*`, `reauthentication_token`), which GoTrue cannot read
("Database error finding user"); the demo user had them.

## Application

| Piece | Where | Notes |
|---|---|---|
| Identity verification | `src/lib/auth/google-identity.ts` | Copied from Xpot `server/auth/googleIdentity.ts` |
| Identity links | `src/lib/auth/identities.ts` | Same rule as Xpot: email alone never claims an account |
| Users | `src/lib/auth/users.ts` | Replaces `auth.admin.getUserById` / `listUsers`; `createAppUser` requires an email and creates the `auth.users` shadow first |
| Sessions | `src/lib/auth/session.ts` | 30-day rolling, same as Xpot; sha-256 of the token stored |
| Supabase JWT | `src/lib/auth/supabase-jwt.ts` | Temporary bridge: Supabase-issued 1-hour token via the service role key; delete with Supabase |
| Pending Google link | `src/lib/auth/pending-link.ts` | 10-minute signed cookie, replaces Xpot's `session.pendingGoogle` |
| After sign-in | `src/lib/auth/post-login.ts` | Invite and active-org logic moved out of `/auth/callback` |
| Routes | `src/app/api/auth/{config,identity,logout,token}` | Same-origin check and rate limit on `identity` |
| Browser SDK | `src/lib/auth/google-identity-client.ts` | Copied from Xpot; in-memory Firebase persistence |
| Sign-in UI | `src/components/auth/login-dialog.tsx` | Phone, code, Google; no password, sign-up or reset forms |

Removed: `src/actions/auth.ts`, `/auth/callback`, `/auth/update-password`, the password section in Settings,
`updatePassword`, `@supabase/ssr`. `src/proxy.ts` no longer refreshes a token: it only re-issues the session cookie.
Clients are created with supabase-js's `accessToken` option, which makes any leftover `supabase.auth.*` throw. Only `supabase-jwt.ts` may call `auth.admin` and `verifyOtp`.

## Who can get in

Same order as Xpot, with org membership in place of Xpot's approval review:

1. A linked Google identity or a known phone: signed in.
2. Google with no link and no account found: `phone_required`, then the texted code links them.
3. Unknown phone with a valid invite link in the browser and no account on the invited email: account created, invite accepted. An invite never attaches a phone to an existing account, because org admins can read and choose invite tokens, so a token does not prove who owns the email.
4. Unknown phone with no invite: `no_access`, no account is created.
5. Signed in but in no organization: `no_org`, no session.

Open sign-up ends: new people join by invitation. New accounts need an email, since the bridge keys on it. Existing accounts without a phone get in by a phone set with `scripts/link-user-phone.ts`.

## Operations, in order

1. Identity Platform: add `xphere.app`, `www.xphere.app`, `xphere-stage.skale.club` to authorized domains; check the API key's referrer restrictions and the SMS region policy.
2. GitHub Secrets and `coolify-set-envs.yml`: `SESSION_SECRET`, `GOOGLE_AUTH_ENABLED`, `GOOGLE_AUTH_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `GOOGLE_WEB_CLIENT_ID`. Values reach production before the code that needs them.
3. `npx supabase db push` (includes the NULL-token repair). The old code keeps working on the new foreign keys.
4. Link the admin phone with `scripts/link-user-phone.ts`. The number is passed as an argument and is never committed.
5. Merge to `main`; `build-deploy.yml` releases it (about 8 minutes).
6. Re-run the backfill, in case an old-code sign-up landed during the release.
7. Sign in by SMS on production, then link Google, then check data, Realtime and sign-out. **Manual: the code arrives on the owner's phone.**
8. After a week without problems: disable sign-ups in Supabase Auth, remove the Google provider there, and drop the legacy env vars.

## Rollback

Revert the merge. `auth.users`, its identities and the Supabase Google provider are untouched until step 8, and the new
tables and repointed foreign keys are compatible with the old code.

## Known limits

- The Google consent screen shows the OAuth brand of the `skaleclub` project, shared with Xpot.
- Sign-in only works on authorized domains, so a white-label host needs its domain added first.
- One Identity Platform project serves Xpot and Xphere, so a phone has one Firebase UID in both. Accounts stay separate: each app keeps its own links.

## Invariants to keep

- No `redirect()` inside the sign-in flow: the client navigates behind a lock that never releases.
- Every sign-in failure explains itself in the dialog. No failure path returns to a bare `/`.
- No new sequential `await` in the dashboard layout (see the performance contract in that file).
- No `supabase.auth.*` under `src/`: a test enforces it.

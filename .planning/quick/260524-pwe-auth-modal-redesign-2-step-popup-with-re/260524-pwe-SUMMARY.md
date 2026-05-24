---
phase: 260524-pwe-auth-modal-redesign
plan: 01
type: quick-task
tags: [auth, ui, security, captcha, refactor]
key-files:
  created:
    - src/lib/auth/verify-turnstile.ts
    - src/lib/auth/errors.ts
    - src/actions/auth.ts
  modified:
    - src/components/auth/login-dialog.tsx
    - src/components/landing/landing-page.tsx
    - src/app/auth/callback/route.ts
    - src/app/api/auth/callback/route.ts
    - src/app/api/google/oauth/route.ts
    - src/app/api/google/callback/route.ts
    - src/app/api/google/calendar-oauth/route.ts
    - src/app/api/google/calendar-callback/route.ts
    - src/app/api/meta/callback/route.ts
    - src/app/(dashboard)/layout.tsx
    - src/app/(admin)/layout.tsx
    - src/actions/knowledge.ts
    - src/app/page.tsx
    - src/app/robots.ts
    - src/app/sitemap.ts
    - src/components/layout/app-sidebar.tsx
    - src/components/layout/sidebar.tsx
    - package.json
    - package-lock.json
    - tests/auth/callback.test.ts
    - tests/auth/rls-isolation.test.ts
    - tests/auth.test.ts
    - tests/auth-routing.test.ts
    - tests/google-callback-route.test.ts
    - tests/meta-callback-route.test.ts
    - (+ ~30 (dashboard) pages/layouts/actions updated by the sweep)
  deleted:
    - src/app/(auth)/login/page.tsx
    - src/app/(auth)/layout.tsx
decisions:
  - Locked: forced redirects (auth gates, sign-out, OAuth callback errors) go to bare `/`; `?auth=login|signup|reset` is reserved exclusively for user-clicked landing-page Links
  - Server actions own captcha verification; the dialog never calls `signInWithPassword`/`signUp` from the client anymore
  - Google OAuth bypasses Turnstile entirely (Step 1 button calls `signInWithOAuth` directly)
  - Step 2 split into `Step2SignInForm` + `Step2SignUpForm` for clean TS narrowing (avoids `UseFormReturn` union mismatch on `<Form {...form}>`)
metrics:
  completed: 2026-05-24
  commits: 3
---

# Quick Task 260524-pwe: Auth Modal Redesign Summary

Single-modal auth flow (Step 1 email + Turnstile → Step 2 password → optional reset view) replaces the dedicated `/login` page. All forced redirects across the app now land silently on `/`; the auth modal is opened only by user-clicked LP links carrying `?auth=login|signup|reset`.

## Commits

- `6bac25b` — feat(260524-pwe-01): 2-step LoginDialog with Cloudflare Turnstile + landing query-param wiring
- `315537c` — fix(260524-pwe-02): sweep all /login redirects to bare / (locked decision)
- `eb39538` — refactor(260524-pwe-03): delete (auth) route group; update tests for bare-/ redirect contract

## What changed

### `src/components/auth/login-dialog.tsx` (rewrite)

- New public API:
  - `LoginDialog({ children?, open?, onOpenChange?, initialMode?, initialView? })`
  - Exported types `AuthMode = 'signin' | 'signup'` and `AuthView = 'step1' | 'step2' | 'reset'`
  - Controlled-open mode is active when `open` is provided; falls back to internal `useState` + `<DialogTrigger asChild>{children}</DialogTrigger>` when no `open` prop is given (backward-compat).
- Three render branches gated by `view`:
  - **Step 1** (`<Step1Form>`): Google button → divider → email input → invisible Cloudflare Turnstile widget → Continue. Continue is disabled until `captchaToken` is set (or always enabled if `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset — graceful local-dev fallback).
  - **Step 2** (`<Step2SignInForm>` / `<Step2SignUpForm>`, dispatched by `<Step2Form>`): read-only email header (`Signed in as / Signed up as`), password (+ confirmPassword for signup), Forgot-password link (sign-in only), Voltar button preserving the captured email and captcha token, Submit that calls the new server actions.
  - **Reset** (`<ResetForm>`): email-only form → `supabase.auth.resetPasswordForEmail(email, { redirectTo: '/auth/callback?next=/dashboard' })` → "Check your email" confirmation with a Back-to-sign-in button.
- State surface: `view`, `mode`, `email`, `captchaToken`, `emailSent`, `resetSent`, `authError`. `switchMode` (footer toggle) resets all of these and snaps back to Step 1, forcing a fresh Turnstile token on re-issue. Controlled-open `useEffect` syncs `view`/`mode` to `initialView`/`initialMode` whenever the dialog opens.
- Visual styling tokens (`inputClass`, `inputWithIconClass`, `GoogleButton`, `Divider`, `AuthError`, `PasswordInput`) are preserved — only form layout changed. Turnstile widget renders no visible UI (`size: 'invisible'`, `appearance: 'interaction-only'`).
- On `captcha_failed` from the server action, Step 2 routes the user back to Step 1 and clears `captchaToken` so a fresh challenge is issued.

### `src/components/landing/landing-page.tsx`

- Removed `<LoginDialog>` wrappers (3 sites: header, hero, CTA). Each CTA button became a plain `<Link href="/?auth=login">…</Link>`.
- Added a single controlled `<LoginDialog open={dialogOpen} onOpenChange={…} initialMode={…} initialView={…} />` at the top of the tree.
- New `<AuthQueryParamSync>` child component reads `useSearchParams()` and flips dialog state when `?auth=login|signup|reset` is present. Wrapped in `<Suspense fallback={null}>` (required for `useSearchParams` in Next 16).
- `<Link href="/?auth=…">` in the LP is the **only** legitimate source of `?auth=` in href values anywhere in the codebase.

### `src/lib/auth/verify-turnstile.ts` (new)

POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response`, optional `remoteip`. Returns `{ success: false }` whenever the token is missing, the secret env var is unset, the network call throws, or Cloudflare's `success` field is false. Includes JSDoc header documenting the required env vars.

### `src/lib/auth/errors.ts` (new)

- `mapSupabaseError(message)` — shared between the dialog (display) and server actions (return shape).
- `authErrorCodeToMessage(code)` — translates stable codes (`captcha_failed`, `unknown_error`) into user copy.

### `src/actions/auth.ts` (new server actions)

- `signInWithEmail({ email, password, captchaToken })` and `signUpWithEmail({ email, password, captchaToken, emailRedirectTo? })`.
- Both actions call `verifyTurnstile(captchaToken, x-forwarded-for)` as the **first step** and short-circuit with `{ ok: false, errorCode: 'captcha_failed' }` if it returns `{ success: false }`. Only on captcha success do they instantiate the server-side Supabase client and call `signInWithPassword` / `signUp`.
- Return type: `{ ok: true, hasSession: boolean }` on success or `{ ok: false, errorCode, errorMessage? }` on failure.

## The `/login` → `/` sweep (Task 2)

All forced redirects updated to bare `/` per the locked decision (Option A — `?auth=` is reserved for user-clicked LP links only).

**Category A — server-side `redirect('/login')` → `redirect('/')`:** 36 call sites across `src/app/(dashboard)/**`, `src/app/(admin)/layout.tsx`, and `src/actions/knowledge.ts` (auth gates in protected layouts, pages, and server actions).

**Category B — client-side `router.push('/login')` → `router.push('/')`:** 2 sign-out handlers — `src/components/layout/app-sidebar.tsx` and `src/components/layout/sidebar.tsx`.

**Category C — OAuth/API callback error redirects:** All 7 callback routes drop the error code from the URL and redirect to bare `/`:
- `src/app/auth/callback/route.ts` (6 error branches: missing_code, auth_failed, no_email, invite_lookup_failed, not_invited, membership_failed)
- `src/app/api/auth/callback/route.ts`
- `src/app/api/google/oauth/route.ts`, `src/app/api/google/callback/route.ts`, `src/app/api/google/calendar-oauth/route.ts`, `src/app/api/google/calendar-callback/route.ts`
- `src/app/api/meta/callback/route.ts`

**Category D — non-redirect references:**
- `src/app/page.tsx` JSON-LD `SearchAction.target` → bare `SITE_URL/`.
- `src/app/robots.ts` `allow: ['/']` (dropped `/login`).
- `src/app/sitemap.ts` `/login` entry removed.

## Files deleted (Task 3)

- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/layout.tsx`
- (The empty `src/app/(auth)/` directory is also gone — Next's route tree no longer references it.)

The OAuth callback at `src/app/auth/callback/route.ts` lives **outside** the deleted `(auth)` group and is untouched.

## Tests updated

- `tests/auth/callback.test.ts` — 3 assertions changed from `expect.stringContaining('error=…')` to exact `'http://localhost:4267/'` checks, matching the new bare-`/` redirect contract. The successful-invite-acceptance test's URL check switched from "not contains `error=not_invited`" to "contains `/dashboard`" (more precise). Also fixed the `org_members` mock to include `select/eq/limit/maybeSingle` shape required by the existing-member fast path that was added to the callback recently — `1` pre-existing test failure resolved as a side effect.
- `tests/auth/rls-isolation.test.ts` — three URL constructors that read the deleted login page now point at `src/components/auth/login-dialog.tsx` (for `zodResolver` + Google OAuth check) and `src/actions/auth.ts` (for the `signInWithPassword` static check, since that call moved server-side).
- `tests/auth.test.ts`, `tests/auth-routing.test.ts`, `tests/google-callback-route.test.ts`, `tests/meta-callback-route.test.ts` — `.todo` description strings updated to use bare `/`. The obsolete `auth-routing` todo about "authenticated request to `/login` redirects to `/organizations` via auth layout" was deleted (auth layout no longer exists).

Tests run: `npx vitest run tests/auth/callback.test.ts tests/auth/rls-isolation.test.ts` → **11 passed, 0 failed**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Pre-existing test mock missing for `org_members` select chain**
- **Found during:** Task 3 test run
- **Issue:** `tests/auth/callback.test.ts > creates org_members row and marks invite accepted` was already failing on `main` (4 callback tests failed before my changes). The `org_members` mock only supplied `upsert`, but the callback route's existing-member fast path (recently added) calls `.from('org_members').select(...).eq(...).limit(1).maybeSingle()` before the upsert.
- **Fix:** Extended the `org_members` mock to include `select`, `eq`, `limit`, `maybeSingle` returning `{ data: null }` (so the fast path falls through to the invite-acceptance path the test was originally asserting).
- **Files modified:** `tests/auth/callback.test.ts`
- **Scope justification:** This test was inside my Task 3 update list and the fix was a 5-line mock extension; leaving it broken would have failed acceptance criteria.

**2. [Rule 1 — Bug] Type error from union form types in `<Form {...form}>`**
- **Found during:** Task 1 build verification
- **Issue:** The first draft of `Step2Form` used a conditional `const form = isSignup ? signUpForm : signInForm` and spread `{...form}` onto `<Form>`. TypeScript could not narrow the resulting `UseFormReturn<{ password }> | UseFormReturn<{ password, confirmPassword }>` union against `<Form>`'s expected single-shape prop.
- **Fix:** Split `Step2Form` into two sibling components (`Step2SignInForm`, `Step2SignUpForm`), each owning its own `useForm` with a concrete value type. `Step2Form` is now a thin dispatcher that returns one or the other based on `mode`.
- **Files modified:** `src/components/auth/login-dialog.tsx`
- **Commit:** included in `eb39538` (Task 3 commit)

### Auth gates

None encountered. Turnstile env vars (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) are documented but not required for build/test — the dialog gracefully no-ops the captcha gate when the site key is unset (Continue button stays enabled), and the server action's `verifyTurnstile` returns `{ success: false }` when the secret is unset, which the dialog handles by routing back to Step 1 with an error.

## Env vars the user must set (out-of-band)

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<public site key from Cloudflare dashboard>
TURNSTILE_SECRET_KEY=<server-side secret from Cloudflare dashboard>
```

Issue both keys at: https://dash.cloudflare.com → Turnstile → Add site.

Until these are set in `.env.local` (and Vercel project env vars), the captcha gate is effectively bypassed: Step 1's Continue button is always enabled, and the server-action `verifyTurnstile()` always returns `{ success: false }` — meaning email/password auth will fail closed with a `captcha_failed` error in production. Set both env vars before deploying.

## Verification log

- `npm install @marsidev/react-turnstile` — added 1 package.
- `npm run build` — exits 0 (TypeScript + Next compile pass).
- `npx vitest run tests/auth/callback.test.ts tests/auth/rls-isolation.test.ts` — 11/11 passed.
- `grep -rnE "['\"\`]/login" src/` — 0 matches.
- `grep -rnE "['\"\`]/login" tests/` — 0 matches.
- `grep -rn "redirect('/?auth=login')" src/` — 0 matches.
- `grep '"@marsidev/react-turnstile"' package.json` — 1 match.
- `ls src/app/(auth)/` — directory does not exist.

## Self-Check: PASSED

All claims verified:
- `src/lib/auth/verify-turnstile.ts` exists.
- `src/lib/auth/errors.ts` exists.
- `src/actions/auth.ts` exists.
- `src/components/auth/login-dialog.tsx` rewritten (imports `Turnstile`, exports `AuthMode`/`AuthView`).
- `src/components/landing/landing-page.tsx` modified (Suspense + useSearchParams + controlled dialog + 3 `<Link href="/?auth=login">`).
- `src/app/(auth)/login/page.tsx` and `src/app/(auth)/layout.tsx` deleted (verified `ls` reports not found).
- All 3 commits (`6bac25b`, `315537c`, `eb39538`) present in `git log`.
- Build passes, callback + RLS-isolation tests pass.

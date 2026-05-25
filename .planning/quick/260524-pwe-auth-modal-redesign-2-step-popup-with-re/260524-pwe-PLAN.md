---
phase: 260524-pwe-auth-modal-redesign
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/auth/login-dialog.tsx
  - src/components/landing/landing-page.tsx
  - src/lib/auth/verify-turnstile.ts
  - src/app/page.tsx
  - src/app/robots.ts
  - src/app/sitemap.ts
  - src/components/layout/app-sidebar.tsx
  - src/components/layout/sidebar.tsx
  - src/actions/knowledge.ts
  - src/app/(admin)/layout.tsx
  - src/app/(dashboard)/layout.tsx
  - src/app/(dashboard)/widget/page.tsx
  - src/app/(dashboard)/knowledge/page.tsx
  - src/app/(dashboard)/organizations/page.tsx
  - src/app/(dashboard)/reviews/page.tsx
  - src/app/(dashboard)/workflows/flows/[id]/page.tsx
  - src/app/(dashboard)/workflows/flows/[id]/runs/page.tsx
  - src/app/(dashboard)/workflows/flows/new/page.tsx
  - src/app/(dashboard)/workflows/flows/runs/[runId]/page.tsx
  - src/app/(dashboard)/calls/(tabs)/layout.tsx
  - src/app/(dashboard)/settings/layout.tsx
  - src/app/(dashboard)/settings/workspace/page.tsx
  - src/app/(dashboard)/settings/profile/page.tsx
  - src/app/(dashboard)/settings/custom-fields/page.tsx
  - src/app/(dashboard)/settings/locations/page.tsx
  - src/app/(dashboard)/scheduling/page.tsx
  - src/app/(dashboard)/scheduling/calendar/page.tsx
  - src/app/(dashboard)/scheduling/availability/page.tsx
  - src/app/(dashboard)/scheduling/bookings/page.tsx
  - src/app/(dashboard)/email-marketing/page.tsx
  - src/app/(dashboard)/email-marketing/new/page.tsx
  - src/app/(dashboard)/email-marketing/[id]/page.tsx
  - src/app/(dashboard)/email-marketing/[id]/preview/page.tsx
  - src/app/(dashboard)/integrations/twilio/page.tsx
  - src/app/(dashboard)/integrations/telegram/page.tsx
  - src/app/(dashboard)/integrations/evolution/page.tsx
  - src/app/(dashboard)/integrations/meta/page.tsx
  - src/app/(dashboard)/integrations/meta/actions.ts
  - src/app/(dashboard)/integrations/manychat/page.tsx
  - src/app/(dashboard)/integrations/manychat/rules/page.tsx
  - src/app/(dashboard)/integrations/manychat/events/page.tsx
  - src/app/(dashboard)/integrations/google-reviews/page.tsx
  - src/app/(dashboard)/integrations/google-contacts/page.tsx
  - src/app/(dashboard)/integrations/google-contacts/actions.ts
  - src/app/auth/callback/route.ts
  - src/app/api/auth/callback/route.ts
  - src/app/api/google/oauth/route.ts
  - src/app/api/google/callback/route.ts
  - src/app/api/google/calendar-oauth/route.ts
  - src/app/api/google/calendar-callback/route.ts
  - src/app/api/meta/callback/route.ts
  - src/app/(auth)/login/page.tsx
  - src/app/(auth)/layout.tsx
  - tests/auth/rls-isolation.test.ts
  - tests/auth/callback.test.ts
  - tests/auth.test.ts
  - tests/auth-routing.test.ts
  - tests/google-callback-route.test.ts
  - tests/meta-callback-route.test.ts
autonomous: true
---

<objective>
Refactor the auth UX into a single modal-driven flow. The login modal becomes a 2-step popup (email/Google first, then password) with a reset-password third state, controlled by the toggle in the footer. The dedicated `/login` route is removed and replaced everywhere with `/` (landing page). Optional `?auth=login|signup|reset` query params auto-open the modal, but those params now only come from user-initiated clicks on the landing-page buttons — never from forced redirects.

Purpose: Single, fast, modal-first auth surface. No dedicated pages. Unauthenticated dashboard access bounces silently to the landing page; if the user wants to sign in again they click the Login button on the LP.

Output:
- New 3-state `LoginDialog` (Step1 -> Step2 -> Reset) controlled internally + via URL query params
- Landing page reads `?auth=` and forces the dialog open in the matching state (param sourced only from user-clicked Links)
- Cloudflare Turnstile invisible captcha integrated into Step 1 (email/password flow) using `@marsidev/react-turnstile` + server-side `verifyTurnstile()` helper wired into the email/password auth server actions
- All `redirect('/login')`, `router.push('/login')`, and external `/login?error=...` callbacks updated to bare `/` (locked decision: redirects do NOT carry `?auth=login`)
- `/login` route, layout file, and any stale `/signup` / `/reset-password` references removed; tests updated
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@src/components/auth/login-dialog.tsx
@src/components/landing/landing-page.tsx
@src/app/(auth)/login/page.tsx
@src/app/(auth)/layout.tsx
@src/components/layout/app-sidebar.tsx
@src/app/auth/callback/route.ts

<interfaces>
<!-- Existing exported contracts the executor will preserve / replace -->

From src/components/auth/login-dialog.tsx (CURRENT — to be refactored):
```typescript
export function LoginDialog({ children }: { children: React.ReactNode }): JSX.Element
```
Internal state today: `mode: 'signin' | 'signup'`, `emailSent: string | null`.
Imports used: `createClient` from `@/lib/supabase/client`, `Dialog/DialogContent/DialogTitle/DialogDescription/DialogTrigger` from `@/components/ui/dialog`, `Form/FormField/FormItem/FormLabel/FormControl/FormMessage` from `@/components/ui/form`, `Button`, `Input`, `react-hook-form`, `zodResolver`, `zod`, icons from `lucide-react`.

From src/components/landing/landing-page.tsx (CURRENT):
```typescript
export function LandingPage({
  faviconUrl,
  ctaImageUrl,
  scrollImages,
}: {
  faviconUrl?: string | null
  ctaImageUrl?: string | null
  scrollImages?: string[]
}): JSX.Element
```
It wraps its CTA buttons in `<LoginDialog>{children}</LoginDialog>`. Currently a `'use client'` component.

Supabase client (already used in the dialog):
```typescript
// from @/lib/supabase/client
export function createClient(): SupabaseClient
// supabase.auth.signInWithPassword({ email, password })
// supabase.auth.signUp({ email, password, options: { emailRedirectTo } })
// supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
// supabase.auth.resetPasswordForEmail(email, { redirectTo })
```

OAuth callback (KEEP — lives at `src/app/auth/callback/route.ts`, NOT under `(auth)/callback/`):
```typescript
export async function GET(request: Request): Promise<NextResponse>
```
This file currently builds error URLs like `${origin}/login?error=<code>` — those must change to bare `${origin}/` per locked redirect decision (errors are silently swallowed; user clicks Login on LP to retry).

New module to be created by this plan (Task 1):
```typescript
// src/lib/auth/verify-turnstile.ts
export async function verifyTurnstile(token: string | null | undefined, remoteIp?: string | null): Promise<{ success: boolean }>
```
Posts to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response`, optional `remoteip`. Reads `TURNSTILE_SECRET_KEY` from `process.env`. Returns `{ success: false }` if the token is missing, the secret is unset, the network call throws, or Cloudflare's `success` field is false.

Cloudflare Turnstile React wrapper (new dependency):
```typescript
// from @marsidev/react-turnstile
import { Turnstile } from '@marsidev/react-turnstile'
// <Turnstile siteKey={...} options={{ appearance: 'interaction-only', size: 'invisible' }} onSuccess={(token: string) => void} onError={() => void} onExpire={() => void} />
```
</interfaces>

<reality_notes>
Orchestrator's planning_context contains a few inaccuracies confirmed by grep. The plan reflects reality:
- The dialog file is `src/components/auth/login-dialog.tsx`, NOT `src/components/landing/auth-dialog.tsx`.
- There is **no** `src/app/(auth)/signup/` or `src/app/(auth)/reset-password/` directory. Only `src/app/(auth)/login/page.tsx` and `src/app/(auth)/layout.tsx` exist.
- The OAuth callback lives at `src/app/auth/callback/route.ts` (outside the `(auth)` route group). The `(auth)` group only contains `login/` and `layout.tsx`, so the entire `(auth)/` group will be removed after this plan.
- There is **no** `middleware.ts` (root or `src/`) — auth gating is done per-layout/page via `redirect('/login')`. The sweep therefore replaces ~40 inline `redirect('/login')` call sites with `redirect('/')`.
- There is **no** `src/lib/actions/auth.ts`. Sign-out lives inline in `src/components/layout/app-sidebar.tsx:110-114` and `src/components/layout/sidebar.tsx:~72`. There are 2 occurrences of `redirect('/login')` in `src/actions/knowledge.ts`, not `src/lib/actions/auth.ts`.
- Captcha IS in scope (user clarification): Cloudflare Turnstile in invisible mode using `@marsidev/react-turnstile`. Library is NOT currently installed; Task 1 installs it. Env vars `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` must be set by the user — the plan does NOT touch `.env` files.
- Locked redirect target (user clarification, Option A): ALL forced redirects (logout, unauthenticated-bounce, OAuth callback errors) go to bare `/`. The `?auth=login|signup|reset` query param is reserved exclusively for user-clicked Links on the landing page. This is a behavior change from earlier drafts of this plan that used `redirect('/?auth=login')`.
</reality_notes>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Refactor LoginDialog into 2-step + reset flow, add Cloudflare Turnstile invisible captcha, and add query-param auto-open on landing page</name>

  <read_first>
    - src/components/auth/login-dialog.tsx (entire file — full rewrite)
    - src/components/landing/landing-page.tsx (entire file — add controlled-open wiring)
    - package.json (to confirm dependency add)
  </read_first>

  <files>
    - src/components/auth/login-dialog.tsx (rewrite)
    - src/components/landing/landing-page.tsx (modify: import useSearchParams + Suspense wrapper; lift dialog open state; remove DialogTrigger usage so it can also auto-open)
    - src/lib/auth/verify-turnstile.ts (new file)
    - package.json (add `@marsidev/react-turnstile` dependency)
    - Any existing email/password auth server actions invoked from the dialog (wire `verifyTurnstile()` gate — discover via `grep -rn "signInWithPassword\|supabase.auth.signUp" src/` and route the dialog through them; if no dedicated server action exists today the dialog calls Supabase directly from the client, in which case Task 1 introduces server actions for signin/signup so the captcha gate can run server-side)
  </files>

  <behavior>
    - Step 1 (initial): renders Google button, an email `<Input type="email">`, an invisible Cloudflare Turnstile widget, and a "Continue" button. Submitting validates email via the existing zod schema (`z.string().email(...)`) and transitions to Step 2 carrying the email value AND the Turnstile token. The Continue button is DISABLED until `captchaToken` is non-null.
    - Step 2 (login mode): renders the captured email as read-only header text, a password `<PasswordInput>`, a "Forgot password?" link button, a "Voltar" back button (returns to Step 1, preserves email AND captchaToken), and a Submit button. On submit calls the signin server action with `{ email, password, captchaToken }`. The server action runs `verifyTurnstile(captchaToken, remoteIp)` first and rejects if `{ success: false }`. On success `router.push('/dashboard')`.
    - Step 2 (signup mode): same as login plus a `confirmPassword` field validated via `.refine(d => d.password === d.confirmPassword)`. On submit calls the signup server action with `{ email, password, captchaToken }`. Server action runs `verifyTurnstile()` first. If `data.session` returns, redirect to `/dashboard`; otherwise show "Check your email" success view.
    - Reset state: a third view (not a 4th step — sibling of Step 1/Step 2). Triggered by the "Forgot password?" link in Step 2. Shows email field + Submit button. Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/dashboard` })`. On success shows confirmation copy "We sent a password reset link to <email>". Has a "Back to sign in" button that returns to Step 1.
    - Mode toggle in the footer (current behavior preserved): footer buttons switch `mode` between `'signin'` and `'signup'`. Switching modes always resets to Step 1, clears any captured email, AND clears `captchaToken` (forces re-issue of a fresh token). When the modal is in the reset view, the footer shows a "Back to sign in" affordance instead of the mode toggle.
    - Controlled open via prop: dialog exports a new signature that accepts optional controlled open state so the landing page can auto-open it based on URL query params.
    - **OAuth (Google) bypasses captcha entirely.** The Google button on Step 1 calls `supabase.auth.signInWithOAuth` directly; it does NOT require `captchaToken` and is NOT blocked by the disabled-Continue gate.
  </behavior>

  <action>
    **A. Install Cloudflare Turnstile dependency:**
    ```bash
    npm install @marsidev/react-turnstile
    ```
    Verify with `grep '"@marsidev/react-turnstile"' package.json`.

    **A2. Create `src/lib/auth/verify-turnstile.ts`:**
    ```typescript
    const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

    export async function verifyTurnstile(
      token: string | null | undefined,
      remoteIp?: string | null,
    ): Promise<{ success: boolean }> {
      const secret = process.env.TURNSTILE_SECRET_KEY
      if (!secret || !token) return { success: false }
      try {
        const body = new URLSearchParams({ secret, response: token })
        if (remoteIp) body.set('remoteip', remoteIp)
        const res = await fetch(VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        })
        if (!res.ok) return { success: false }
        const data = (await res.json()) as { success?: boolean }
        return { success: data.success === true }
      } catch {
        return { success: false }
      }
    }
    ```

    **A3. Wire `verifyTurnstile()` into the email/password auth server actions.**
    First discover whether server actions already exist for signin/signup:
    ```bash
    grep -rn "signInWithPassword\|supabase.auth.signUp" src/
    ```
    - If the dialog currently calls Supabase directly from the client (most likely): introduce `src/actions/auth.ts` exporting `signInWithEmail({ email, password, captchaToken })` and `signUpWithEmail({ email, password, captchaToken })` server actions. Each action:
      1. Calls `const { success } = await verifyTurnstile(captchaToken, headers().get('x-forwarded-for'))`
      2. If `!success`, returns `{ error: 'captcha_failed' }` (do NOT call Supabase)
      3. Otherwise creates a server-side Supabase client (`createClient` from `@/lib/supabase/server`) and calls `signInWithPassword` / `signUp`
      4. Returns `{ error: mapSupabaseError(error) }` on failure or `{ ok: true }` on success
      The dialog's Step 2 submit handler calls these actions instead of calling Supabase from the browser. The existing `mapSupabaseError` helper in the dialog can move to `src/lib/auth/errors.ts` and be imported by both the dialog (for display) and the actions (to shape the return).
    - If server actions already exist: add the `verifyTurnstile()` gate as the FIRST step of each, returning `{ error: 'captcha_failed' }` before any Supabase call.

    **B. Rewrite `src/components/auth/login-dialog.tsx`:**

    1. Change exported component signature from `LoginDialog({ children })` to:
       ```typescript
       export type AuthMode = 'signin' | 'signup'
       export type AuthView = 'step1' | 'step2' | 'reset'

       export interface LoginDialogProps {
         children?: React.ReactNode
         open?: boolean
         onOpenChange?: (open: boolean) => void
         initialMode?: AuthMode          // default 'signin'
         initialView?: AuthView          // default 'step1'
       }

       export function LoginDialog(props: LoginDialogProps): JSX.Element
       ```
       Backward-compat: when `open` is `undefined`, fall back to internal `useState(false)` and use `<DialogTrigger asChild>{children}</DialogTrigger>` exactly as today. When `open` is provided, treat it as fully controlled and omit the trigger if `children` is undefined.

    2. Add a `view` state alongside `mode`, plus `captchaToken`:
       ```typescript
       const [view, setView] = useState<AuthView>(props.initialView ?? 'step1')
       const [mode, setMode] = useState<AuthMode>(props.initialMode ?? 'signin')
       const [email, setEmail] = useState('')
       const [captchaToken, setCaptchaToken] = useState<string | null>(null)
       const [emailSent, setEmailSent] = useState<string | null>(null)
       const [resetSent, setResetSent] = useState<string | null>(null)
       const [authError, setAuthError] = useState<string | null>(null)
       ```
       When `props.open` flips from `false` to `true` and `props.initialView` is set, reset internal `view`/`mode` to match the requested initial state (`useEffect` on `[props.open, props.initialView, props.initialMode]`). Do NOT clear `captchaToken` on open (a fresh widget mount will issue a new one anyway); DO clear it whenever the user navigates back to Step 1 from Step 2 via "Voltar" only if the widget remounts — let the `onSuccess` callback be the single source of truth.

    3. Replace the current `SignInForm`/`SignUpForm` with three internal components, each rendered conditionally on `view`:
       - `<Step1Form onContinue={(email) => { setEmail(email); setView('step2'); }} mode={mode} captchaToken={captchaToken} onCaptchaToken={setCaptchaToken} onError={setAuthError} />` — contains the existing `GoogleButton` + `Divider` + the email field + the invisible Turnstile widget + Continue submit button.
         The Turnstile widget is rendered as:
         ```tsx
         import { Turnstile } from '@marsidev/react-turnstile'
         // ...
         <Turnstile
           siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
           options={{ appearance: 'interaction-only', size: 'invisible' }}
           onSuccess={(token) => onCaptchaToken(token)}
           onError={() => { onCaptchaToken(null); onError('captcha_failed') }}
           onExpire={() => onCaptchaToken(null)}
         />
         ```
         The Continue button is `disabled={!captchaToken || formState.isSubmitting}`. Email zod schema unchanged: `z.object({ email: z.string().email('Enter a valid email') })`.
       - `<Step2Form mode={mode} email={email} captchaToken={captchaToken} onBack={() => setView('step1')} onForgot={() => setView('reset')} onEmailSent={setEmailSent} onError={setAuthError} />` — shows the email as read-only label text (`<p className="text-[0.8125rem] text-[#A1A1AA]">{email}</p>`), password field, confirm password field (only when `mode === 'signup'`), a small "Forgot password?" `<button type="button">` styled as a link that calls `onForgot`, a "Voltar" ghost button (`<Button variant="ghost">` with `<ArrowLeft className="mr-2 h-4 w-4" />Voltar`) that calls `onBack`, and the existing Submit button labelled "Sign in" or "Sign up" depending on mode. The submit handler calls the `signInWithEmail` / `signUpWithEmail` server action from step A3 passing `{ email, password, captchaToken }`. If the action returns `{ error: 'captcha_failed' }`, the handler clears `captchaToken` (via a callback prop) and routes the user back to Step 1 with an error toast — a fresh Turnstile token must be issued.
       - `<ResetForm initialEmail={email} onBack={() => { setView('step1'); setResetSent(null); }} onSent={setResetSent} onError={setAuthError} />` — single email field (zod email schema), Submit button labelled "Send reset link", calls `supabase.auth.resetPasswordForEmail(values.email, { redirectTo: `${origin}/auth/callback?next=/dashboard` })`. On success calls `onSent(values.email)`. If `resetSent` is non-null, show the confirmation view: `"We sent a password reset link to {resetSent}"` + a "Back to sign in" button calling `onBack`. Reset does NOT require captcha (Supabase rate-limits this endpoint).

    4. Header text logic (top of dialog body):
       - `view === 'step1' && mode === 'signin'` -> "Welcome back" / "Sign in to your workspace"
       - `view === 'step1' && mode === 'signup'` -> "Create your account" / "Get started with Xphere"
       - `view === 'step2'` -> same titles as above but subtitle becomes "Continue as `{email}`"
       - `view === 'reset' && !resetSent` -> "Reset your password" / "We'll email you a reset link"
       - `view === 'reset' && resetSent` -> "Check your email" / `"We sent a reset link to {resetSent}"`
       - `mode === 'signup' && emailSent` (signup confirmation case) -> "Check your email" / `"We sent a confirmation link to {emailSent}"` (preserve existing behavior)

    5. Footer logic:
       - When `view === 'reset'`, render a single centered `<button>` "Back to sign in" calling `setView('step1')`.
       - Otherwise preserve the existing mode toggle (Don't have an account? / Already have an account?). The `switchMode` helper must also reset `view` to `'step1'`, clear `email`, `captchaToken`, `emailSent`, `resetSent`, and `authError`.

    6. Keep all existing styling tokens (`inputClass`, `inputWithIconClass`, `GoogleButton`, `Divider`, `AuthError`, `PasswordInput`, `mapSupabaseError`) — do not re-skin the modal. The visual look stays identical; only the form layout changes. The Turnstile widget in `size: 'invisible'` mode renders no visible UI in the normal path; reserve no visual slot.

    7. Export the additional types alongside the component so the landing page can import them:
       ```typescript
       export type { AuthMode, AuthView }
       ```

    **C. Modify `src/components/landing/landing-page.tsx`:**

    1. Add `import { useSearchParams } from 'next/navigation'` and `import { useEffect, useState, Suspense } from 'react'`.
    2. Inside `LandingPage`, add:
       ```typescript
       const searchParams = useSearchParams()
       const authParam = searchParams.get('auth') // 'login' | 'signup' | 'reset' | null
       const [dialogOpen, setDialogOpen] = useState(false)
       const [initialMode, setInitialMode] = useState<'signin' | 'signup'>('signin')
       const [initialView, setInitialView] = useState<'step1' | 'step2' | 'reset'>('step1')

       useEffect(() => {
         if (authParam === 'login') { setInitialMode('signin'); setInitialView('step1'); setDialogOpen(true) }
         else if (authParam === 'signup') { setInitialMode('signup'); setInitialView('step1'); setDialogOpen(true) }
         else if (authParam === 'reset') { setInitialMode('signin'); setInitialView('reset'); setDialogOpen(true) }
       }, [authParam])
       ```
    3. Render a single controlled `<LoginDialog open={dialogOpen} onOpenChange={setDialogOpen} initialMode={initialMode} initialView={initialView} />` at the top level of the returned JSX (no `children`, no trigger).
    4. Replace each `<LoginDialog>...trigger button...</LoginDialog>` wrapper in the existing JSX (there are 3 sites: header, hero, CTA) with the existing button content as `<Link>` elements pointing at the query-param URLs:
       - Header "Login" / "Sign in" button: `<Link href="/?auth=login">...</Link>`
       - Hero "Get started" / signup button: `<Link href="/?auth=signup">...</Link>` (or `/?auth=login` if the desired intent is signin — preserve current behavior; the default in the existing code was `signin` for all three, so keep `signin` unless the executor confirms a distinct signup CTA exists)
       - CTA section button: same as header
       These `<Link>` clicks navigate to `/?auth=...`, the `useEffect` above picks the param up, and the dialog auto-opens. This is the ONLY place `?auth=` should appear in any href in the codebase.
       Rationale (per locked user decision): forced redirects go to bare `/`; only user-initiated LP clicks set the query param.
    5. Because `useSearchParams` requires a Suspense boundary in Next 16, wrap the body of `LandingPage` in `<Suspense fallback={null}>...</Suspense>` if it isn't already inside one. Import `Suspense` from `'react'`.

    **D. Document required env vars (informational — DO NOT add to `.env*` files):**
    Leave a comment block at the top of `src/lib/auth/verify-turnstile.ts`:
    ```typescript
    /**
     * Cloudflare Turnstile server-side verification.
     *
     * Required env vars (set by user, not by this plan):
     *   NEXT_PUBLIC_TURNSTILE_SITE_KEY — public site key (consumed by the React widget)
     *   TURNSTILE_SECRET_KEY           — server-side secret (consumed by this helper)
     *
     * Both keys are issued from the Cloudflare dashboard:
     *   https://dash.cloudflare.com -> Turnstile -> Add site.
     */
    ```
  </action>

  <verify>
    <automated>npm install && npm run build</automated>
    Then run these grep checks and confirm:
    - `grep '"@marsidev/react-turnstile"' package.json` returns 1 match (dependency installed).
    - `test -f src/lib/auth/verify-turnstile.ts` exits 0 and `grep -n "challenges.cloudflare.com/turnstile/v0/siteverify" src/lib/auth/verify-turnstile.ts` returns 1 match.
    - `grep -nE "view === 'step1'|view === 'step2'|view === 'reset'" src/components/auth/login-dialog.tsx` returns at least 3 matches.
    - `grep -n "from '@marsidev/react-turnstile'" src/components/auth/login-dialog.tsx` returns 1 match.
    - `grep -nE "size: 'invisible'|appearance: 'interaction-only'" src/components/auth/login-dialog.tsx` returns at least 1 match.
    - `grep -n "captchaToken" src/components/auth/login-dialog.tsx` returns at least 3 matches (state + Step1 prop + Step2 submit).
    - `grep -nE "useSearchParams|authParam" src/components/landing/landing-page.tsx` returns at least 2 matches.
    - `grep -nE "DialogTrigger" src/components/landing/landing-page.tsx` returns 0 matches (trigger is gone; dialog is controlled).
    - `grep -nE "href=\"/\\?auth=(login|signup|reset)\"" src/components/landing/landing-page.tsx` returns at least 1 match (LP buttons use Link with auth param).
    - `grep -nE "resetPasswordForEmail" src/components/auth/login-dialog.tsx` returns at least 1 match.
    - `grep -n "verifyTurnstile" src/actions/auth.ts src/lib/auth/verify-turnstile.ts 2>/dev/null | wc -l` >= 2 (helper exported + invoked by at least one server action).
  </verify>

  <acceptance_criteria>
    - [ ] `npm run build` exits 0 (TypeScript + Next compile pass)
    - [ ] `package.json` contains `@marsidev/react-turnstile` in `dependencies`
    - [ ] `src/lib/auth/verify-turnstile.ts` exists, exports `verifyTurnstile`, and POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify`
    - [ ] `src/components/auth/login-dialog.tsx` imports `Turnstile` from `@marsidev/react-turnstile`
    - [ ] `src/components/auth/login-dialog.tsx` contains `size: 'invisible'` or `appearance: 'interaction-only'`
    - [ ] The signin/signup server actions call `verifyTurnstile()` BEFORE any Supabase call and return an error (do NOT call Supabase) when `verifyTurnstile()` returns `{ success: false }`
    - [ ] `grep -c "export function LoginDialog" src/components/auth/login-dialog.tsx` == 1
    - [ ] `grep -c "export type AuthView\|export type { AuthMode" src/components/auth/login-dialog.tsx` >= 1
    - [ ] `grep -c "useSearchParams" src/components/landing/landing-page.tsx` >= 1
    - [ ] `grep -c "DialogTrigger" src/components/landing/landing-page.tsx` == 0
    - [ ] `grep -cE "href=\"/\\?auth=" src/components/landing/landing-page.tsx` >= 1 (LP buttons are the ONLY place `?auth=` appears in hrefs)
    - [ ] `grep -c "signInWithPassword" src/components/auth/login-dialog.tsx src/actions/auth.ts 2>/dev/null | awk -F: '{s+=$2} END{print s}'` >= 1
    - [ ] `grep -c "supabase.auth.signUp" src/components/auth/login-dialog.tsx src/actions/auth.ts 2>/dev/null | awk -F: '{s+=$2} END{print s}'` >= 1
    - [ ] `grep -c "resetPasswordForEmail" src/components/auth/login-dialog.tsx` >= 1
    - [ ] Manual smoke (notes for executor): visiting `/?auth=login` opens dialog in Step 1 sign-in; `/?auth=signup` opens Step 1 sign-up; `/?auth=reset` opens reset view. Visiting `/` (no param) opens nothing. Clicking the header "Start" button opens Step 1 sign-in. Entering email + "Continue" is BLOCKED until Turnstile issues a token, then advances to Step 2. Step 2 "Voltar" returns to Step 1 with email preserved. Step 2 "Forgot password?" -> reset view. Google OAuth button on Step 1 works regardless of captcha state.
  </acceptance_criteria>

  <done>
    Dialog renders 3 views (step1, step2, reset) driven by internal state with invisible Cloudflare Turnstile gating the Continue button; URL query param `?auth=login|signup|reset` on the landing page auto-opens the modal in the requested state (param sourced only from LP `<Link>` clicks); mode toggle still works; server-side `verifyTurnstile()` blocks the email/password auth server actions when the token is missing or invalid; build passes.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Sweep all `/login` (and any `/signup`, `/reset-password`) references to bare `/` (locked redirect target)</name>

  <read_first>
    - src/components/layout/app-sidebar.tsx
    - src/components/layout/sidebar.tsx
    - src/actions/knowledge.ts
    - src/app/auth/callback/route.ts
    - src/app/api/auth/callback/route.ts
    - src/app/api/google/oauth/route.ts
    - src/app/api/google/callback/route.ts
    - src/app/api/google/calendar-oauth/route.ts
    - src/app/api/google/calendar-callback/route.ts
    - src/app/api/meta/callback/route.ts
    - src/app/(dashboard)/layout.tsx
    - src/app/page.tsx
    - src/app/robots.ts
    - src/app/sitemap.ts
  </read_first>

  <files>
    All `files_modified` entries in this plan's frontmatter EXCEPT:
    - src/components/auth/login-dialog.tsx (Task 1)
    - src/components/landing/landing-page.tsx (Task 1)
    - src/lib/auth/verify-turnstile.ts (Task 1)
    - src/app/(auth)/login/page.tsx (Task 3 deletes it)
    - src/app/(auth)/layout.tsx (Task 3 deletes it)
    - tests/* (Task 3)
  </files>

  <action>
    Replace every reference to the dead `/login` route with bare `/` (locked user decision — Option A). Forced redirects must NEVER carry `?auth=login`; the query param is reserved exclusively for user-clicked Links on the landing page (set in Task 1).

    **Category A — Server-side `redirect('/login')` in protected pages/layouts/server actions:**
    Replace `redirect('/login')` -> `redirect('/')`
    Apply to (these are ALL occurrences from `grep -rn "redirect('/login')" src`):
    - `src/actions/knowledge.ts` (lines 12, 169)
    - `src/app/(admin)/layout.tsx:9`
    - `src/app/(dashboard)/layout.tsx:23`
    - `src/app/(dashboard)/widget/page.tsx:27`
    - `src/app/(dashboard)/knowledge/page.tsx:13`
    - `src/app/(dashboard)/organizations/page.tsx:10`
    - `src/app/(dashboard)/reviews/page.tsx:22`
    - `src/app/(dashboard)/workflows/flows/[id]/page.tsx:14`
    - `src/app/(dashboard)/workflows/flows/[id]/runs/page.tsx:34`
    - `src/app/(dashboard)/workflows/flows/new/page.tsx:11`
    - `src/app/(dashboard)/workflows/flows/runs/[runId]/page.tsx:25`
    - `src/app/(dashboard)/calls/(tabs)/layout.tsx:10`
    - `src/app/(dashboard)/settings/layout.tsx:7`
    - `src/app/(dashboard)/settings/workspace/page.tsx:14`
    - `src/app/(dashboard)/settings/profile/page.tsx:10`
    - `src/app/(dashboard)/settings/custom-fields/page.tsx:24`
    - `src/app/(dashboard)/settings/locations/page.tsx:11`
    - `src/app/(dashboard)/scheduling/page.tsx:18`
    - `src/app/(dashboard)/scheduling/calendar/page.tsx:12`
    - `src/app/(dashboard)/scheduling/availability/page.tsx:11`
    - `src/app/(dashboard)/scheduling/bookings/page.tsx:14`
    - `src/app/(dashboard)/email-marketing/page.tsx:11`
    - `src/app/(dashboard)/email-marketing/new/page.tsx:10`
    - `src/app/(dashboard)/email-marketing/[id]/page.tsx:23`
    - `src/app/(dashboard)/email-marketing/[id]/preview/page.tsx:16`
    - `src/app/(dashboard)/integrations/twilio/page.tsx:13`
    - `src/app/(dashboard)/integrations/telegram/page.tsx:13`
    - `src/app/(dashboard)/integrations/evolution/page.tsx:12`
    - `src/app/(dashboard)/integrations/meta/page.tsx:33`
    - `src/app/(dashboard)/integrations/meta/actions.ts:26`
    - `src/app/(dashboard)/integrations/manychat/page.tsx:14`
    - `src/app/(dashboard)/integrations/manychat/rules/page.tsx:15`
    - `src/app/(dashboard)/integrations/manychat/events/page.tsx:23`
    - `src/app/(dashboard)/integrations/google-reviews/page.tsx:70`
    - `src/app/(dashboard)/integrations/google-contacts/page.tsx:15`
    - `src/app/(dashboard)/integrations/google-contacts/actions.ts:53`

    **Category B — Client-side `router.push('/login')` in sign-out handlers:**
    Replace `router.push('/login')` -> `router.push('/')`
    - `src/components/layout/app-sidebar.tsx:113`
    - `src/components/layout/sidebar.tsx:72`

    **Category C — OAuth/API callback error redirects with query strings:**
    All OAuth error redirects go to bare `/` per locked decision. The error code is dropped from the URL (the LP will not surface it; users retry via the Login button). Apply these substitutions:
    - `src/app/auth/callback/route.ts` (lines 15, 24, 36, 73, 81, 100) — six occurrences. Replace each `${origin}/login?error=<code>` -> `${origin}/`.
    - `src/app/api/auth/callback/route.ts:34` — replace `${origin}/login?error=auth_callback_failed` -> `${origin}/`.
    - `src/app/api/google/oauth/route.ts:17` — replace `new URL('/login', request.url)` -> `new URL('/', request.url)`.
    - `src/app/api/google/callback/route.ts:35` — replace `buildRedirect(request, '/login')` -> `buildRedirect(request, '/')`.
    - `src/app/api/google/calendar-oauth/route.ts:14` — replace `new URL('/login', request.url)` -> `new URL('/', request.url)`.
    - `src/app/api/google/calendar-callback/route.ts:14` — replace `new URL('/login', request.url)` -> `new URL('/', request.url)`.
    - `src/app/api/meta/callback/route.ts:44` — replace `buildRedirect(request, '/login')` -> `buildRedirect(request, '/')`.

    **Category D — Non-redirect references to `/login`:**
    - `src/app/page.tsx:67` — JSON-LD `SearchAction` target: change `${SITE_URL}/login` -> `${SITE_URL}/`.
    - `src/app/robots.ts:10` — change `allow: ['/', '/login']` -> `allow: ['/']`.
    - `src/app/sitemap.ts:15` — remove the entire object that references `${base}/login` (do NOT replace it — `/` is already in the sitemap as the home entry).

    **Sweep verification:** After applying all substitutions, run
    `grep -rnE "['\"\`]/login['\"\`?]|['\"\`]/signup['\"\`]|['\"\`]/reset-password['\"\`]" src/` and confirm zero matches.

    **Out of scope explicitly:** Do NOT touch files inside `node_modules/`, `.next/`, or `dist/`. Do NOT touch `.planning/`. Do NOT touch `src/components/landing/landing-page.tsx` — its `<Link href="/?auth=login">` (and signup/reset variants) ARE the legitimate sources of the `?auth=` query param and must remain.
  </action>

  <verify>
    <automated>npm run build</automated>
    Plus these greps:
    - `grep -rn "redirect('/?auth=login')" src/` returns 0 matches (locked decision: no forced redirect carries the auth param).
    - `grep -rn "redirect('/login')" src/` returns 0 matches.
    - `grep -rnE "['\"\\\`]/login['\"\\\`?]" src/` returns 0 matches.
    - `grep -rnE "['\"\\\`]/signup['\"\\\`]" src/` returns 0 matches.
    - `grep -rnE "['\"\\\`]/reset-password['\"\\\`]" src/` returns 0 matches.
    - `grep -c "redirect('/')" src/app/(dashboard)/layout.tsx` == 1
    - `grep -c "redirect('/')" src/actions/knowledge.ts` == 2
    - `grep -rn "/?auth=login" src/app/` excluding `src/app/page.tsx` returns 0 matches (no API/callback/page outside the landing component generates the auth param).
  </verify>

  <acceptance_criteria>
    - [ ] `npm run build` exits 0
    - [ ] `grep -rn "redirect('/?auth=login')" src/` returns 0 matches (locked: forced redirects use bare `/`)
    - [ ] `grep -rn "redirect('/login')" src/` returns 0 matches (every previously identified call site now uses `redirect('/')`)
    - [ ] `grep -rnE "['\"\\\`]/login" src/` returns 0 lines (no orphan `/login` strings remain anywhere in `src/`)
    - [ ] `grep -rnE "['\"\\\`]/signup" src/` returns 0 lines
    - [ ] `grep -rnE "['\"\\\`]/reset-password" src/` returns 0 lines
    - [ ] `grep -c "redirect('/')" src/app/(dashboard)/layout.tsx` == 1
    - [ ] `grep -c "router.push('/')" src/components/layout/app-sidebar.tsx` >= 1
    - [ ] `grep -c "router.push('/')" src/components/layout/sidebar.tsx` >= 1
    - [ ] `grep -n "/login" src/app/auth/callback/route.ts` returns 0 matches (all 6 callbacks now use bare `/`)
    - [ ] `grep -c "/login" src/app/robots.ts` == 0
    - [ ] `grep -c "/login" src/app/sitemap.ts` == 0
    - [ ] LP buttons that open the modal use `<Link href="/?auth=login">` (or signup/reset variants) — these are the ONLY places `?auth=` appears in href values (verified by Task 1's grep on `landing-page.tsx`)
    - [ ] Manual smoke: hit `/dashboard` while signed out -> bounced silently to `/` (landing page, no modal, no error in URL); click "Login" on LP -> navigates to `/?auth=login` and modal opens; sign out -> lands on `/` (landing page, modal closed).
  </acceptance_criteria>

  <done>
    Every reference to the now-dead `/login`, `/signup`, and `/reset-password` paths in `src/` has been replaced with bare `/` per locked user decision (Option A). Build passes. Forced redirects (logout, unauthenticated-bounce, OAuth callback errors) land silently on the landing page; only user-clicked LP buttons set `?auth=login|signup|reset`.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Delete obsolete `(auth)` route group and update affected tests</name>

  <read_first>
    - src/app/(auth)/login/page.tsx
    - src/app/(auth)/layout.tsx
    - tests/auth/rls-isolation.test.ts
    - tests/auth/callback.test.ts
    - tests/auth.test.ts
    - tests/auth-routing.test.ts
    - tests/google-callback-route.test.ts
    - tests/meta-callback-route.test.ts
  </read_first>

  <files>
    Delete:
    - src/app/(auth)/login/page.tsx
    - src/app/(auth)/layout.tsx
    (After deletion, the `src/app/(auth)/` directory will be empty and Next will drop it from the route tree. The OAuth callback at `src/app/auth/callback/route.ts` is OUTSIDE this group and is NOT affected.)

    Update tests:
    - tests/auth/rls-isolation.test.ts (3 occurrences hardcode `src/app/(auth)/login/page.tsx` path)
    - tests/auth/callback.test.ts (3 occurrences assert `/login?error=...` substrings)
    - tests/auth.test.ts (1 `.todo` mentions `/login`)
    - tests/auth-routing.test.ts (2 `.todo` mention `/login`)
    - tests/google-callback-route.test.ts (2 `.todo` mention `/login`)
    - tests/meta-callback-route.test.ts (1 `.todo` mentions `/login`)
  </files>

  <action>
    **A. Delete the route files:**
    ```bash
    rm src/app/(auth)/login/page.tsx
    rm src/app/(auth)/layout.tsx
    rmdir src/app/(auth)/login || true
    rmdir "src/app/(auth)" || true
    ```
    The two `rmdir` calls succeed only if the directories are empty (they will be — confirmed by `Glob src/app/(auth)/**/*` returning only those two files). If they fail, that signals an unexpected leftover and the executor should investigate before continuing.

    **B. Update `tests/auth/rls-isolation.test.ts`:**
    Lines 51, 60, 69 read the login page file from disk to assert RLS hygiene (it greps the source for raw `supabase` usage). Since the file is gone, the test must instead point at the dialog. Replace the three URL constructors:
    - `new URL('../../src/app/(auth)/login/page.tsx', import.meta.url)` -> `new URL('../../src/components/auth/login-dialog.tsx', import.meta.url)`
    Run the test file with `npm test -- tests/auth/rls-isolation.test.ts` and confirm it still passes (the dialog uses `createClient` from `@/lib/supabase/client`, which is what the test is validating).

    **C. Update `tests/auth/callback.test.ts`:**
    Three `it(...)` cases assert that `/auth/callback` redirects to URLs containing `/login?error=missing_code`, `/login?error=auth_failed`, `/login?error=not_invited`. Per the locked redirect decision (Task 2), the callback now redirects to bare `/` and drops the error code. Update each assertion to expect a redirect to the bare origin path:
    - Replace each `'/login?error=<code>'` assertion with an assertion that the Location header / response URL pathname is exactly `'/'` (no query string).
    - Update the `it(...)` description strings accordingly (e.g., `'redirects to / when code is missing'`).
    If the existing test asserts on the error code itself (e.g., for telemetry), preserve that expectation but switch the URL check to bare `/`. If the test's only purpose was the error-code-in-URL contract, the assertion becomes a simple `'/'` check.

    **D. Update `.todo` test descriptions (no behavior change, just text):**
    Update the human-readable strings inside `it.todo('...')` so they don't reference dead routes — search-and-replace these substrings within each test file's todo strings:
    - `/login` -> `/` (or rewrite the todo if the bare-`/` form no longer makes semantic sense)
    Files: `tests/auth.test.ts`, `tests/auth-routing.test.ts`, `tests/google-callback-route.test.ts`, `tests/meta-callback-route.test.ts`.
    Note: in `tests/auth-routing.test.ts:5` the todo reads "authenticated request to /login redirects to /organizations via auth layout" — that test is now obsolete because there is no auth layout. Delete that single `.todo` line.

    **E. Rollback safety note** (for the executor, do NOT add to PLAN.md as a task): if a future need arises to keep `src/app/(auth)/layout.tsx` for shared chrome on the OAuth callback page, restore it AND move it under `src/app/auth/` (the callback's actual parent). Today the callback is a `route.ts` (not a page.tsx) and renders no UI, so no layout is required — deletion is safe.
  </action>

  <verify>
    <automated>npm run build && npm test -- tests/auth/callback.test.ts tests/auth/rls-isolation.test.ts</automated>
    Plus:
    - `ls "src/app/(auth)/" 2>&1 | grep -E "No such|cannot access"` returns a "not found" message (directory is gone).
    - `grep -rn "src/app/(auth)/login" tests/` returns 0 matches.
    - `grep -rn "/login?error" tests/` returns 0 matches.
  </verify>

  <acceptance_criteria>
    - [ ] `npm run build` exits 0
    - [ ] `npm test -- tests/auth/callback.test.ts` passes (3 cases, expected URLs now bare `/`)
    - [ ] `npm test -- tests/auth/rls-isolation.test.ts` passes (now reading from `src/components/auth/login-dialog.tsx`)
    - [ ] `ls src/app/(auth)/login/page.tsx 2>&1` reports file not found
    - [ ] `ls "src/app/(auth)/layout.tsx" 2>&1` reports file not found
    - [ ] `find "src/app/(auth)" -type f 2>/dev/null | wc -l` == 0 (directory empty or removed)
    - [ ] `grep -rn "/login?error" tests/ src/` returns 0 lines
    - [ ] `grep -rn "src/app/(auth)/login" tests/` returns 0 lines
    - [ ] `npm run lint` exits 0 (no unused imports left behind from deleted files)
    - [ ] Manual smoke: visit `/login` in the browser -> Next returns 404 (route gone); visit `/auth/callback?code=...` -> still works (callback route untouched).
  </acceptance_criteria>

  <done>
    The `(auth)` route group is removed (only `/login` page and layout existed inside it; both deleted). Tests that depended on dead paths or files are updated and pass against the new bare-`/` redirect contract. OAuth callback route at `src/app/auth/callback/route.ts` remains functional. Lint and build pass.
  </done>
</task>

</tasks>

<verification>
End-to-end checks after all 3 tasks:

1. `npm run build` exits 0.
2. `npm run lint` exits 0.
3. `npm test -- tests/auth` passes (callback + rls-isolation tests at minimum).
4. `grep -rnE "['\"\\\`]/login" src/ tests/` returns 0 lines.
5. `grep -rnE "['\"\\\`]/signup" src/ tests/` returns 0 lines.
6. `grep -rnE "['\"\\\`]/reset-password" src/ tests/` returns 0 lines.
7. `find "src/app/(auth)" -type f 2>/dev/null | wc -l` == 0.
8. `grep -c "supabase.auth.resetPasswordForEmail" src/components/auth/login-dialog.tsx` >= 1.
9. `grep '"@marsidev/react-turnstile"' package.json` returns 1 match.
10. `test -f src/lib/auth/verify-turnstile.ts` exits 0.
11. `grep -rn "verifyTurnstile" src/actions/ src/lib/` returns at least 2 matches (helper + at least one server-action call site).
12. `grep -rn "redirect('/?auth=login')" src/` returns 0 matches (locked: forced redirects use bare `/`).
13. Manual smoke pass:
    - Visit `/` -> landing page, no dialog.
    - Visit `/?auth=login` -> dialog auto-opens in Step 1 sign-in.
    - Visit `/?auth=signup` -> dialog auto-opens in Step 1 sign-up.
    - Visit `/?auth=reset` -> dialog auto-opens in reset view.
    - Click "Login" in nav -> URL becomes `/?auth=login`, dialog opens Step 1 sign-in.
    - Email + Continue is DISABLED until Turnstile issues a token; then advances to Step 2.
    - Step 2 submit calls server action, which runs `verifyTurnstile()` before Supabase; submitting with a tampered/missing token returns `captcha_failed` and the user is returned to Step 1.
    - Step 2 "Voltar" returns to Step 1 with email preserved; "Forgot password?" -> reset view.
    - Mode toggle in footer (sign in / sign up) still flips and resets to Step 1 + clears `captchaToken`.
    - Google OAuth button on Step 1 works without captcha token (OAuth bypasses Step 2 entirely).
    - Hit `/dashboard` while signed out -> bounced silently to `/` (no error in URL, no modal).
    - Sign out from sidebar -> lands on `/` (no auth param).
    - Visit `/login` -> Next 404.
    - OAuth flow via `/auth/callback?code=...` still completes; errors land on bare `/`.
</verification>

<success_criteria>
- All 3 tasks' acceptance criteria checked off.
- The literal substring `/login` does not appear anywhere in `src/` or `tests/` (verified by grep).
- `?auth=login|signup|reset` appears in the codebase ONLY inside `src/components/landing/landing-page.tsx` (in `<Link href>` values) — no server-side `redirect()` or API-route response sets that query param.
- `@marsidev/react-turnstile` is installed; the dialog's Step 1 renders an invisible Turnstile widget; the signin/signup server actions reject when `verifyTurnstile()` returns `{ success: false }`.
- Build, lint, and the touched test files all pass.
- Manual smoke (above) passes.
</success_criteria>

<output>
After completion, create `.planning/quick/260524-pwe-auth-modal-redesign-2-step-popup-with-re/260524-pwe-SUMMARY.md` describing:
- What changed in `login-dialog.tsx` (new view state, 3 views, controlled-open API, invisible Turnstile widget on Step 1, captchaToken state)
- What changed in `landing-page.tsx` (query-param wiring, dialog controlled, LP buttons converted to `<Link href="/?auth=...">`)
- New file `src/lib/auth/verify-turnstile.ts` and the new/updated email/password auth server actions that gate on `verifyTurnstile()`
- The 35+ `redirect('/login')` -> `redirect('/')` sweep (list categories A/B/C/D from Task 2) and the locked decision behind the bare-`/` target
- Files deleted (`(auth)/login/page.tsx`, `(auth)/layout.tsx`) and tests updated (callback tests now assert bare `/` redirects)
- Env var requirements for the user to set out-of-band: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (issued from Cloudflare dashboard -> Turnstile -> Add site)
</output>

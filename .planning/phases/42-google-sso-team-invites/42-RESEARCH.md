# Phase 42: Google SSO + Team Invites - Research

**Researched:** 2026-05-16
**Domain:** Auth (OAuth2 / OIDC via Supabase) + multi-tenant invite/membership workflow
**Confidence:** HIGH (stack + patterns are first-party Supabase + reuses 5+ existing migrations and 2 existing OAuth callbacks already in the codebase)

## Summary

Phase 42 layers Google Sign-In on top of the existing Supabase email/password auth. The implementation is small and almost entirely additive: one new migration (`045_org_invites.sql`), one new route handler (`/auth/callback`), one new dashboard route (`/dashboard/members`), and a single new client component injected into the existing `/login` page. **No schema change to `org_members` is needed** — the `role` column with the `('admin','member')` enum already exists from migration `001_foundation.sql`.

The hardest part is not the Google plumbing (Supabase handles PKCE, token exchange, and provider config in the Dashboard); it is the **post-callback invite reconciliation** — looking up the OAuth email against `org_invites`, creating `org_members` rows for every matching org, marking invites accepted, seeding `user_active_org`, and **signing the user out cleanly** when no invite matches. This must be done in a single route handler in a defined order, and there are five RLS / cookie / multi-org edge cases to get right.

**Primary recommendation:** Add `src/app/auth/callback/route.ts` (NEW path — do **not** reuse `/api/auth/callback`, which is OAuth-callback-generic but redirects on success without invite reconciliation; reusing it would silently break Google Contacts integration). Use the **service-role client** for the post-exchange `org_invites → org_members` writes (bypasses the RLS chicken-and-egg where the new user has no membership yet). Reuse the existing `vo_active_org` cookie + `user_active_org` upsert pattern from `src/app/(dashboard)/organizations/actions.ts`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-42-01: Google Sign-In is Additional, Not Replacement** — Add Google as an OAuth provider alongside email/password. Existing email/password login continues unchanged. Users can switch between methods freely.
- **D-42-02: Per-Org Allowlist (Not Domain Restriction)** — Each org maintains `org_invites` table; email NOT in any row is refused at OAuth callback.
- **D-42-03: Dashboard Admin Only (Widget Stays Anonymous)** — Google Sign-In only applies to `/login`. The web widget at `/api/chat/[token]` continues to accept anonymous visitors.
- **D-42-04: No Own MFA — Trust Google's 2FA** — Operator does NOT implement TOTP or WebAuthn.
- **D-42-05: Use Existing `org_members` Table (Not New `memberships`)** — Phase 42 uses `org_members`. The `role` column already exists (verified — see Schema Verification below).
- **D-42-06: OAuth Callback Lives at `/auth/callback`** — `src/app/auth/callback/route.ts`. Flow: User clicks button → Google consent → callback exchanges code → callback queries `org_invites` for the email → no rows = sign out + redirect; rows = INSERT memberships + mark invites accepted + set `user_active_org` + redirect to `/dashboard`.
- **D-42-07: Invite Email Delivery — Deferred (Manual Link Share in v1)** — v1 does NOT send invite emails automatically. Admin shares `https://operator.skale.club/login` URL manually.
- **D-42-08: Invite Expiration = 30 Days** — `expires_at` defaults to `now() + INTERVAL '30 days'`. Expired invites filtered at callback. UI shows "Re-send" which bumps `expires_at`.
- **D-42-09: Role Granularity = `admin` and `member`** — Two roles only. Reuses existing `user_role` enum from migration 001.
- **D-42-10: Email Matching = Normalized (lowercase + trim)** — All emails stored lowercased + trimmed at INSERT and at callback lookup.
- **D-42-11: First Login Creates Membership; Subsequent Logins Just Sign In** — Callback only INSERTs into `org_members` on first successful login (`accepted_at IS NULL`).
- **D-42-12: Revocation Flow** — Revoke pending invite: `DELETE FROM org_invites`. Remove member: `DELETE FROM org_members`. **No active session invalidation in v1** — sessions die naturally on TTL.
- **D-42-13: Auth Callback is `runtime = 'nodejs'`** — `export const runtime = 'nodejs'`.
- **D-42-14: RLS Policies Use Canonical Pattern** — `org_invites` uses `(SELECT public.get_current_org_id())` pattern. Only role='admin' members can INSERT/DELETE (defense in depth: server action + RLS).

### Claude's Discretion

- Whether to enforce admin-only INSERT/DELETE on `org_invites` via RLS policy AND server-action check, or only server action. (Recommendation in CONTEXT.md: both.)
- Whether the Members entry in the sidebar goes top-level or under Settings. (Recommendation: top-level, near Settings.)
- Whether to support **role change** of existing members from the Members UI (vs. only invite + remove).
- The exact button copy / divider styling on `/login` (within shadcn primitives).

### Deferred Ideas (OUT OF SCOPE)

- Invite email automation (Resend/SendGrid) — separate phase or as v2 polish
- Self-service org creation — first Google login creates an org with that user as admin
- Domain auto-allowlist (Workspace SSO style)
- Audit log of logins → Phase 40 observability or separate
- Role granularity beyond admin/member — editor/viewer/billing-only
- Session invalidation on member removal — `auth.admin.signOut(user_id)`
- Magic link login — passwordless email
- GitHub/Microsoft/Apple OAuth — additional providers
- Own MFA (TOTP/WebAuthn) — only if compliance demands it
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Google OAuth provider configured in Supabase; callback route handles redirect | Supabase docs: provider config in Dashboard (Client ID/Secret); `@supabase/ssr@0.10.3` handles PKCE automatically; callback uses `supabase.auth.exchangeCodeForSession(code)`. Existing reference: `src/app/api/auth/callback/route.ts` (generic) and `src/app/api/google/callback/route.ts` (Google Contacts — uses CSRF state cookie, NOT Supabase auth). **NEW route at `/auth/callback` is correct path per D-42-06**. |
| AUTH-02 | `org_invites` table with RLS; admin-only INSERT/SELECT/DELETE | Schema verified vs. existing migrations (next number: **045**). RLS pattern: `(SELECT public.get_current_org_id())`. Admin check via `EXISTS (SELECT 1 FROM org_members WHERE user_id = auth.uid() AND organization_id = $org AND role = 'admin')` — see Code Examples. |
| AUTH-03 | OAuth callback verifies invited email; not-invited → `/login?error=not_invited`; invited → create `org_members` + mark accepted + set `user_active_org` | Reconciliation step runs **after** `exchangeCodeForSession` succeeds. Must use **service-role client** for the writes (new user has no `org_members` row, so RLS would block its own write). Pattern mirrors `createOrganization` in `src/app/(dashboard)/organizations/actions.ts` which already uses `createServiceRoleClient()` for the same reason. |
| AUTH-04 | `/login` shows "Sign in with Google" button above existing form with divider | Add new `'use client'` button component; existing `/login/page.tsx` is already a client component using `createClient()` from `@/lib/supabase/client` — Google button just calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '${origin}/auth/callback' } })`. |
| AUTH-05 | `/dashboard/members` page: list members + pending invites; invite form; revoke pending invite; remove current member | Pattern reuses `src/app/(dashboard)/agents/` structure: `page.tsx` (server component) + `actions.ts` (server actions) + `components/members/*` (split tables + form). Sidebar entry: add to `navItems` in `src/components/layout/app-sidebar.tsx` (Users icon from lucide-react). |
| AUTH-06 | Existing email/password login continues working byte-identically | Zero changes to `signInWithPassword` path. Existing `tests/auth.test.ts` is `it.todo()` stubs — phase 42 should land real tests now that auth is actually getting touched. |
| AUTH-07 | Multi-org: same email invited in 2 orgs gets 2 memberships; OrgSwitcher shows both | Callback loop: `for (const invite of matching_invites) INSERT INTO org_members`. `user_active_org` set to first org in list. Existing `OrgSwitcher` (`src/components/layout/org-switcher.tsx`) already lists all memberships via `getUserOrgs()` — no UI change needed. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

| Constraint | Phase 42 Compliance |
|------------|---------------------|
| Always use cached `getUser()` + `createClient()` from `@/lib/supabase/server` (never raw `supabase.auth.getUser()`) | All server actions in `members/actions.ts` use `await getUser()` first. Callback route must use the raw `createServerClient` (not the cached helper) because `cookies()` mutations need a fresh-per-request client in route handlers. |
| Inbound webhooks always return HTTP 200 | N/A — `/auth/callback` is a 302 redirect handler, not a webhook. |
| Webhook receivers (Vapi etc) use `export const runtime = 'nodejs'` | `/auth/callback` MUST declare `runtime = 'nodejs'` per D-42-13. |
| Forms use `react-hook-form` + `zod` + `zodResolver` | Invite form follows this. Existing reference: `src/components/layout/org-switcher.tsx` (CreateOrgDialog). |
| Toasts use `sonner` | Members page uses `sonner` for invite/revoke/remove confirmations. |
| Server components by default; client components use `'use client'` | Members page = server component; tables can stay server-rendered; only invite form / row-action buttons need `'use client'`. |
| Migrations live in `supabase/migrations/`; never edit old ones; add new ones | Migration **045_org_invites.sql** (next number — verified: 044 is the latest). |
| After migration: `npx supabase db push` then update `src/types/database.ts` manually | Update `database.ts` to add `org_invites` table type. **No change to `org_members` type** (role column already typed). |
| Run `npm run build` after changes (lint script broken in Next.js 16) | Phase 42 quality gate. |
| Multi-tenancy: every table has RLS; never manually filter by `org_id` in authenticated-client queries | `org_invites` gets full RLS; server actions use the cached `createClient()` so RLS auto-scopes. **Service-role client only inside the callback** (justified above). |
| Sensitive: `src/lib/crypto.ts` — do not change encryption format | Not touched. |
| Sensitive: `src/app/api/vapi/*` — keep fast and Node.js-compatible | Not touched. Vapi route handlers use `createClient` from `@supabase/supabase-js` directly with service role (no auth dependency) — Phase 42 cannot affect them. |
| Production origin: `https://operator.skale.club` | OAuth `redirectTo` in production must resolve to `https://operator.skale.club/auth/callback`. Use `${window.location.origin}` in the client component so it works in dev (`localhost:4267`) AND preview deploys AND production. |

## Schema Verification (CRITICAL — resolves Open Question #1)

**`org_members.role` already exists.** Verified in `supabase/migrations/001_foundation.sql` lines 11 + 36:

```sql
CREATE TYPE public.user_role AS ENUM ('admin', 'member');

CREATE TABLE public.org_members (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID              NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID              NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            public.user_role  NOT NULL DEFAULT 'member',
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);
```

And typed in `src/types/database.ts` line 80 (`role: UserRole`).

**Migration 045 does NOT need an `ALTER TABLE org_members ADD COLUMN role`.** CONTEXT D-42-05 says "if not, add it via migration 045" — confirmed not needed. Use the existing `public.user_role` enum directly for `org_invites.role`:

```sql
role public.user_role NOT NULL DEFAULT 'member'
```

(NOT `TEXT … CHECK (role IN …)` as drafted in CONTEXT.md schema sample — reuse the enum for consistency with `org_members`.)

## Existing Auth Callback Inventory (resolves Open Question on file-reuse)

Three callbacks already live in the repo. Phase 42 introduces a fourth at a distinct path. None must be modified.

| Path | Purpose | Method | Reuses? |
|------|---------|--------|---------|
| `src/app/api/auth/callback/route.ts` | Generic Supabase OAuth `code` exchanger; redirects to `next` query param on success | GET | **DO NOT REUSE** for Google SSO — it has no invite reconciliation. Leave it alone for any future passwordless / magic-link flows. |
| `src/app/api/google/callback/route.ts` | **Google Contacts integration** OAuth (v1.7 milestone) — uses CSRF state cookie + custom token storage | GET | Unrelated path. Google Cloud Console will have **two** redirect URIs after Phase 42: one for Google Contacts (existing), one for Supabase OAuth (`https://<project>.supabase.co/auth/v1/callback`). |
| `src/app/api/meta/callback/route.ts` (referenced by `tests/meta-callback-route.test.ts`) | Meta (Facebook/Instagram) OAuth | GET | Unrelated. |
| **NEW `src/app/auth/callback/route.ts`** (Phase 42) | Supabase Google OAuth → invite reconciliation → membership creation | GET | Owns the Google SSO flow. |

**Path choice note:** D-42-06 specifies `/auth/callback` (not `/api/auth/callback`). This is the canonical Supabase docs path and is the URL configured in the Supabase Dashboard's Google provider settings. The existing `/api/auth/callback` lives under `/api/*` (a Next.js convention for API routes) but is functionally a route handler too. Keeping them at different paths avoids any confusion about which handler does what.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/ssr` | `^0.10.0` (installed 0.10.3) | Cookie-based Supabase client for Next.js App Router; handles PKCE for OAuth | Already in use across `lib/supabase/{client,server}.ts`. Handles `code_verifier` cookie automatically. |
| `@supabase/supabase-js` | `^2.101.1` (installed 2.105.4) | Underlying client; `auth.signInWithOAuth`, `auth.exchangeCodeForSession`, `auth.signOut` | Already in use. |
| `next` | `^16.2.2` | App Router + route handlers + Server Actions | Already in use. |
| `react-hook-form` | `^7.72.0` | Invite form | Already standard in the project (per CLAUDE.md). |
| `zod` | `^3.25.76` | Email + role validation | Already standard. |
| `@hookform/resolvers` | `^5.2.2` | `zodResolver` glue | Already standard. |
| `sonner` | `^2.0.7` | Toast notifications | Already standard. |
| `lucide-react` | `^1.7.0` | Icons (Google "G", Users, Mail, MoreHorizontal) | Already standard. There is no first-party Google logo icon in lucide-react v1.7 — use a small inline SVG of the Google "G" mark or the `Chrome` icon as a placeholder. **Recommendation: inline SVG** — see Code Examples. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@radix-ui/react-dropdown-menu` | `^2.1.16` | Per-row action menu on Members table | Members + Invites rows need "Revoke" / "Remove" / "Re-send" actions. |
| `@radix-ui/react-alert-dialog` | `^1.1.15` | Confirm destructive actions (remove member, revoke invite) | Already used elsewhere in the project. |
| `@radix-ui/react-dialog` | `^1.1.15` | Invite form modal | Pattern from `OrgSwitcher.CreateOrgDialog` is the direct template. |
| `@tanstack/react-table` | `^8.21.3` | Sortable members/invites tables | Optional — small dataset; a plain `<Table>` from shadcn primitives is fine. The existing Agents list uses `react-table`; consistency argues for using it here too. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Supabase Auth UI (`@supabase/auth-ui-react`) | Drop-in styled button | Adds a dependency and styling fights with shadcn. Rolling our own button is ~30 lines and looks consistent with the rest of the dashboard. |
| Server Action for Google sign-in trigger | Stay on client `signInWithOAuth` | Server-side trigger requires manually constructing the OAuth URL and managing the `code_verifier` cookie. The client-side path is the documented Supabase pattern — keep it. |
| Edge Runtime for `/auth/callback` | Node runtime (locked by D-42-13) | Edge runtime is faster cold-start but the rest of the auth/API code is Node and consistency wins. Also: service-role client + `crypto.randomUUID()` work on both. |
| Resend / SendGrid invite email in v1 | Deferred (per D-42-07) | Out of scope. Document follow-up. |

**Installation:** No new packages required. All dependencies above are already in `package.json`.

**Version verification (2026-05-16):**
- `@supabase/ssr` registry: 0.10.3 (installed: ^0.10.0 → resolves to 0.10.3) ✓
- `@supabase/supabase-js` registry: 2.105.4 (installed: ^2.101.1 → resolves to 2.105.4) ✓

## Architecture Patterns

### Recommended File Layout

```
supabase/
└── migrations/
    └── 045_org_invites.sql                   # NEW

src/
├── app/
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts                      # NEW — runtime='nodejs'
│   ├── (auth)/
│   │   └── login/
│   │       ├── page.tsx                      # MODIFY — embed GoogleSignInButton
│   │       └── google-signin-button.tsx      # NEW — 'use client'
│   └── (dashboard)/
│       └── members/
│           ├── page.tsx                      # NEW — server component
│           └── actions.ts                    # NEW — server actions
├── components/
│   ├── layout/
│   │   └── app-sidebar.tsx                   # MODIFY — add Members nav entry
│   └── members/
│       ├── members-table.tsx                 # NEW
│       ├── invites-table.tsx                 # NEW
│       ├── invite-form.tsx                   # NEW — 'use client'
│       └── row-actions.tsx                   # NEW — 'use client'
├── lib/
│   └── auth/
│       ├── zod-schemas.ts                    # NEW — email + role schemas
│       └── invite-reconciler.ts              # NEW — pure function used by callback
└── types/
    └── database.ts                           # MODIFY — add org_invites type

tests/
└── auth/
    ├── oauth-callback.test.ts                # NEW
    ├── invite-actions.test.ts                # NEW
    ├── invite-reconciler.test.ts             # NEW
    └── rls.test.ts                           # NEW
```

### Pattern 1: OAuth Callback with Invite Reconciliation
**What:** A single Next.js route handler that runs after Google redirects the user back. It exchanges the OAuth `code` for a Supabase session, then reconciles the new session's email against `org_invites` and seeds `org_members` + `user_active_org`.

**When to use:** Every Google sign-in attempt funnels through this path.

**Why one handler, not two:** Splitting "exchange code" from "reconcile invites" would require a second redirect with the user already authenticated. RLS on the new user's queries would be broken (no membership row yet), forcing a service-role second step anyway. One handler keeps the critical section atomic.

```typescript
// src/app/auth/callback/route.ts
// Source: Supabase docs (https://supabase.com/docs/guides/auth/social-login/auth-google)
// Pattern adapted from existing src/app/api/auth/callback/route.ts (lines 1-35)
import { createServerClient } from '@supabase/ssr'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'   // D-42-13

const ORG_COOKIE = 'vo_active_org'
const COOKIE_OPTS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const }

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        ),
      },
    }
  )

  // 1. Exchange code for session (sets sb-* cookies). PKCE handled automatically.
  const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError || !sessionData.session) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  const user = sessionData.user
  const emailRaw = user.email
  if (!emailRaw) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=no_email`)
  }
  const email = emailRaw.trim().toLowerCase()  // D-42-10

  // 2. Reconcile against org_invites — service role bypasses RLS (new user has no membership yet)
  const admin = createServiceRoleClient()
  const { data: invites } = await admin
    .from('org_invites')
    .select('id, org_id, role')
    .eq('email', email)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())

  if (!invites || invites.length === 0) {
    // D-42-03 / D-42-12 — not invited. Sign out and bounce.
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=not_invited`)
  }

  // 3. Create memberships + mark invites accepted (D-42-07, D-42-11)
  const now = new Date().toISOString()
  for (const inv of invites) {
    await admin
      .from('org_members')
      .upsert(
        { user_id: user.id, organization_id: inv.org_id, role: inv.role },
        { onConflict: 'user_id,organization_id' }   // D-42-11: subsequent logins idempotent
      )
    await admin
      .from('org_invites')
      .update({ accepted_at: now })
      .eq('id', inv.id)
  }

  // 4. Seed user_active_org + vo_active_org cookie
  const firstOrgId = invites[0].org_id
  await admin
    .from('user_active_org')
    .upsert({ user_id: user.id, organization_id: firstOrgId, updated_at: now })

  const { data: org } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', firstOrgId)
    .single()
  if (org) {
    cookieStore.set(ORG_COOKIE, JSON.stringify({ id: org.id, name: org.name }), COOKIE_OPTS)
  }

  return NextResponse.redirect(`${origin}/`)
}
```

### Pattern 2: Server Actions for Invite/Member CRUD (mirrors agents/actions.ts)

```typescript
// src/app/(dashboard)/members/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { inviteEmailSchema } from '@/lib/auth/zod-schemas'

export async function inviteByEmail(input: { email: string; role: 'admin' | 'member' }) {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = inviteEmailSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()

  // 1. Resolve current org (RLS-safe via SECURITY DEFINER fn)
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  // 2. Verify current user is admin of this org (defense in depth on top of RLS)
  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId as string)
    .single()
  if (!membership || membership.role !== 'admin') {
    return { error: 'Only admins can invite members.' }
  }

  const email = parsed.data.email.trim().toLowerCase()
  const { error } = await supabase
    .from('org_invites')
    .insert({
      org_id: orgId as string,
      email,
      role: parsed.data.role,
      invited_by: user.id,
    })
  if (error?.code === '23505') return { error: 'This email is already invited or a member.' }
  if (error) return { error: error.message }

  revalidatePath('/members')
  return { ok: true }
}
```

### Pattern 3: Client-Side Google Sign-In Trigger

```typescript
// src/app/(auth)/login/google-signin-button.tsx
'use client'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function GoogleSignInButton() {
  const [pending, setPending] = useState(false)
  async function handleClick() {
    setPending(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) setPending(false)   // success path navigates away
  }
  return (
    <Button type="button" variant="outline" className="w-full" onClick={handleClick} disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon className="mr-2 h-4 w-4" />}
      {pending ? 'Redirecting...' : 'Sign in with Google'}
    </Button>
  )
}
```

### Anti-Patterns to Avoid

- **Modifying `src/app/api/auth/callback/route.ts`** — that route is generic Supabase OAuth (currently unused by anything in production but may be wired later for magic-link). Adding invite reconciliation there would couple all future auth flows to invite logic. Make a new file.
- **Using the cached `createClient()` from `lib/supabase/server.ts` inside the callback route handler** — that helper uses `cache()` which is scoped to the React render tree. Route handlers don't have one. Use the raw `createServerClient` call as shown above (matches the existing `/api/auth/callback/route.ts` exactly).
- **Doing the `org_invites` lookup with the *authenticated* client** — the new user just got a session but has zero `org_members` rows yet. `(SELECT public.get_current_org_id())` returns NULL → every RLS-scoped query returns empty → no invites visible → user always sees `not_invited` even when valid. **Use the service-role client.**
- **Letting `email` matching be case-sensitive** — Google may return `User.Email@gmail.com` once and `user.email@gmail.com` another time. Lowercase + trim at insert AND at lookup (D-42-10).
- **Forgetting to call `supabase.auth.signOut()` in the not-invited branch** — without it, the user has a valid Supabase session and can hit `/dashboard/*`. RLS will return empty data (no `org_members` row), so they'll see broken/empty pages instead of a friendly bounce.
- **Using `INSERT ... ON CONFLICT DO NOTHING` for the membership without thinking about role updates** — if a re-invite changes the role, an upsert with role in the SET clause is correct. CONTEXT.md D-42-11 says "subsequent logins just sign in," which argues for `upsert` (idempotent re-creation if a row was deleted) but **not** for role mutation on re-login. Best: `upsert(..., { onConflict: 'user_id,organization_id', ignoreDuplicates: true })` OR check whether the membership already exists before inserting.
- **Setting `vo_active_org` cookie without checking that the org row exists** — service-role read is bypassing RLS so we always get the row, but defensive `.single()` + null-check is cheap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth code exchange / PKCE | Custom `fetch` to Google's token endpoint with `code_verifier` cookie management | `supabase.auth.exchangeCodeForSession(code)` (`@supabase/ssr` automatically reads the `sb-*-auth-token-code-verifier` cookie) | Browser-side PKCE has tricky cookie scoping. Supabase handles it. |
| Google OAuth client init | Custom client ID + secret env vars (`SUPABASE_AUTH_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_GOOGLE_SECRET`) used in app code | Configure in **Supabase Dashboard → Authentication → Providers → Google**. CONTEXT.md schema says "No env vars needed in Operator." | Supabase stores the secret server-side and exposes the provider via the SDK. Putting the secret in our env duplicates state and risks key leaks. |
| Email validation | Manual regex | `z.string().email()` | Already in use; covers RFC edge cases. |
| Email normalization | Manual `.toLowerCase().trim()` everywhere | Single `normalizeEmail` helper in `lib/auth/zod-schemas.ts` + `.transform()` in the zod schema | One source of truth prevents bugs where one path normalizes and another doesn't. |
| Cookie writing for active org | New cookie code | Reuse `ORG_COOKIE = 'vo_active_org'` constant + same JSON shape from `src/app/(dashboard)/organizations/actions.ts` | Cookie name and shape are load-bearing for `DashboardLayout` (line 16-28). Diverging breaks the layout. |
| Service-role client | New `createClient(URL, SERVICE_KEY)` | `createServiceRoleClient()` from `@/lib/supabase/admin` | Already exists and documented as "ONLY import this in trusted server-only code." |
| Admin check in server actions | Custom RPC | Inline `EXISTS` check against `org_members` (`role = 'admin'`) | Two queries (`getUser()` + `org_members.role` select). Don't introduce a new SQL function for two lines. |
| Membership lookup helper | Manual SQL | `supabase.rpc('get_current_org_id')` already exists (migration 007) | Use it. |

**Key insight:** Supabase + the existing migration 001/007/etc. patterns give us 90% of this phase for free. The actual code Phase 42 ships is a few hundred lines of glue: one route handler, one migration, ~6 server actions, one new login button, one new dashboard page.

## Common Pitfalls

### Pitfall 1: Supabase Dashboard Google provider must be configured BEFORE first deploy
**What goes wrong:** `signInWithOAuth({ provider: 'google' })` returns "Provider not enabled" error in production.
**Why it happens:** The provider config lives in Supabase Dashboard, not in Operator's env vars. If HUMAN-UAT step (CONTEXT.md "Operator-Side Setup") is skipped, the SDK has nothing to call.
**How to avoid:** Phase 42 plan MUST include a `HUMAN-UAT.md` checklist with: (1) Google Cloud Console project ready, (2) OAuth consent screen published, (3) Authorized redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback` (NOT `operator.skale.club/auth/callback` — that's the **app-side** path, not Google-side), (4) Client ID/Secret pasted into Supabase Dashboard, (5) Google provider toggle ON.
**Warning signs:** `error_code=provider_not_enabled` in callback URL after sign-in attempt.

### Pitfall 2: Two redirect URIs in Google Cloud Console (existing Google Contacts + new Supabase)
**What goes wrong:** Admin assumes one Google project = one redirect URI, accidentally replaces the existing v1.7 Google Contacts callback (`https://operator.skale.club/api/google/callback`).
**Why it happens:** Pre-existing v1.7 Google Contacts integration uses its own OAuth flow with a different redirect URI. Phase 42 adds a new redirect URI for Supabase Auth.
**How to avoid:** HUMAN-UAT explicitly states: "Add a NEW Authorized redirect URI. Do NOT replace existing ones." Two URIs must coexist: `https://operator.skale.club/api/google/callback` (Google Contacts, v1.7) and `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase OAuth — note this is on the Supabase domain, not Operator).
**Warning signs:** v1.7 Google Contacts connect flow stops working after Phase 42 ships.

### Pitfall 3: PKCE code_verifier cookie gets stripped by `signInWithPassword` re-render
**What goes wrong:** User clicks "Sign in with Google" but `exchangeCodeForSession` fails with "invalid grant" because the `code_verifier` cookie is missing.
**Why it happens:** `@supabase/ssr` writes `sb-*-auth-token-code-verifier` cookie with `sameSite: 'lax'`. If anything between the click and the callback strips cookies (CDN, middleware, browser extension), the verifier is gone and the code can't be exchanged.
**How to avoid:** Make sure no Next.js middleware strips Supabase cookies. The Operator project does NOT use middleware for auth (per CLAUDE.md: "Auth gating happens in layouts, pages, route handlers, and server actions instead of middleware"). Verify Vercel's edge config doesn't strip cookies on `/auth/callback`.
**Warning signs:** First login fails with `auth_callback_failed` but second click works (cookie set by first redirect).

### Pitfall 4: RLS chicken-and-egg in the callback
**What goes wrong:** Callback uses the *user's* authenticated client to write the `org_members` row. RLS policy `WITH CHECK (organization_id = (SELECT public.get_current_org_id()))` evaluates to NULL (user has no membership yet → `get_current_org_id()` returns NULL → INSERT blocked).
**Why it happens:** The user just authenticated. Until their first `org_members` row exists, `get_current_org_id()` returns NULL.
**How to avoid:** Use `createServiceRoleClient()` for the membership INSERT, invite UPDATE, and `user_active_org` UPSERT inside the callback. Service role bypasses RLS by design — exactly the right tool here. Pattern matches `createOrganization()` in `organizations/actions.ts` which has the same problem (new org has no members yet).
**Warning signs:** First-login users always land on `not_invited` even when invites exist; or the redirect succeeds but the dashboard layout's `get_current_org_id()` call returns NULL.

### Pitfall 5: Multi-org invite race — same email, two pending invites, only first one INSERTed
**What goes wrong:** User has invites in Org A and Org B. Callback inserts membership in A and B, but only marks invite A accepted (loop bug, transaction-not-atomic, etc.).
**Why it happens:** The `for (const invite of invites)` loop is not transactional. If the second iteration throws, the user has a session and one membership but a "still pending" invite for the second org.
**How to avoid:** Wrap the membership-creation logic in a Postgres function (`accept_invites(user_id, email)`) called via `rpc()` so the membership inserts and invite updates happen in a single transaction. **Or** accept the non-atomicity for v1 (the loop bug is rare; re-login would re-process the still-pending invite as a fresh first-time login because no `org_members` row exists for Org B yet — actually NO, `org_members` DOES exist if the INSERT succeeded; only the invite UPDATE failed). Plan should pick one.
**Warning signs:** UI shows "1 pending invite" for an org the user is already a member of.

### Pitfall 6: Email-on-record vs. email-on-invite mismatch
**What goes wrong:** Admin invites `bob@example.com`. Bob's Google account email is `bob.dev@example.com` (alias). Lookup fails.
**Why it happens:** Gmail aliases (`+tag`, dots in user portion, etc.) make exact-string match fragile.
**How to avoid:** Document explicitly in the Members UI: "We match the email exactly. If your Google account uses a different email, ask admin to invite that exact email." Phase 42 does **not** normalize Gmail aliases (dot-stripping, `+tag` removal) — too easy to over-match and create security holes. D-42-10 is just lowercase + trim.
**Warning signs:** Users report "I clicked Google, signed in successfully, but got a not_invited error."

### Pitfall 7: `org_members` `UNIQUE(user_id, organization_id)` collision on re-invitation flow
**What goes wrong:** Admin removes a member, re-invites them, member signs in → callback tries to INSERT → unique-constraint violation.
**Why it happens:** D-42-12 deletes from `org_members` on removal but the invite-acceptance INSERT doesn't check.
**How to avoid:** Use `upsert(..., { onConflict: 'user_id,organization_id' })` for the membership INSERT (as shown in Pattern 1 code). Idempotent re-creation handles both D-42-11 (no double-INSERT on second login) AND re-invitation after removal.

### Pitfall 8: `not_invited` user is left signed in (sees broken dashboard)
**What goes wrong:** Callback bounces user to `/login?error=not_invited` but their Supabase session cookie is still valid; they navigate to `/dashboard/` and see empty pages.
**Why it happens:** `exchangeCodeForSession` already set the session cookie. Redirecting to `/login` doesn't sign them out.
**How to avoid:** `await supabase.auth.signOut()` BEFORE the redirect in the not-invited branch (shown in Pattern 1).
**Warning signs:** Browser DevTools shows `sb-*-auth-token` cookie after a not-invited bounce.

### Pitfall 9: `vo_active_org` cookie set with wrong shape
**What goes wrong:** Cookie is set as `{org_id: ...}` instead of `{id: ..., name: ...}`; dashboard layout's parser at `src/app/(dashboard)/layout.tsx:22` fails silently and falls back to DB query — works, but slower.
**Why it happens:** Easy typo; the existing constant `ORG_COOKIE = 'vo_active_org'` and JSON shape live in `organizations/actions.ts` and aren't exported as a shared constant.
**How to avoid:** Factor `ORG_COOKIE` + a `setActiveOrgCookie(id, name)` helper into `lib/auth/active-org-cookie.ts` and import it from BOTH places. Or just be careful and write a test that asserts the cookie shape.

## Code Examples

### Migration 045 — `org_invites` table
```sql
-- supabase/migrations/045_org_invites.sql
-- Source: CONTEXT.md D-42-02 schema + adaptation to reuse public.user_role enum
-- Reuses: public.user_role enum from 001_foundation.sql
-- Pattern: (SELECT public.get_current_org_id()) RLS canonical from 001/007

CREATE TABLE public.org_invites (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID              NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email       TEXT              NOT NULL,
  role        public.user_role  NOT NULL DEFAULT 'member',
  invited_by  UUID              NOT NULL REFERENCES auth.users(id),
  invited_at  TIMESTAMPTZ       NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ       NULL,
  expires_at  TIMESTAMPTZ       NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  UNIQUE (org_id, email)
);

CREATE INDEX idx_org_invites_email_pending
  ON public.org_invites(email)
  WHERE accepted_at IS NULL;

CREATE INDEX idx_org_invites_org_id ON public.org_invites(org_id);

ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

-- Admin-only INSERT (D-42-14 defense in depth)
CREATE POLICY "invites_insert_admin" ON public.org_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
        AND organization_id = (SELECT public.get_current_org_id())
        AND role = 'admin'
    )
  );

-- All members of the org can SELECT (to render the list)
CREATE POLICY "invites_select_member" ON public.org_invites
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- Admin-only DELETE (revoke)
CREATE POLICY "invites_delete_admin" ON public.org_invites
  FOR DELETE TO authenticated
  USING (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
        AND organization_id = (SELECT public.get_current_org_id())
        AND role = 'admin'
    )
  );

-- Admin-only UPDATE (re-send: bump expires_at)
CREATE POLICY "invites_update_admin" ON public.org_invites
  FOR UPDATE TO authenticated
  USING (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
        AND organization_id = (SELECT public.get_current_org_id())
        AND role = 'admin'
    )
  )
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.org_invites IS
  'Phase 42 (v2.0): per-org email allowlist for Google SSO. First OAuth login of an invited email creates org_members row and marks accepted_at.';
```

### Zod schemas
```typescript
// src/lib/auth/zod-schemas.ts
import { z } from 'zod'

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export const inviteEmailSchema = z.object({
  email: z.string().email('Enter a valid email').transform(normalizeEmail),
  role: z.enum(['admin', 'member']).default('member'),
})
export type InviteEmailInput = z.infer<typeof inviteEmailSchema>
```

### Inline Google "G" icon (no lucide-react primitive available)
```typescript
// src/app/(auth)/login/google-signin-button.tsx
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335"/>
    </svg>
  )
}
```

### Sidebar entry addition
```typescript
// src/components/layout/app-sidebar.tsx — add to navItems array (line 43)
import { Users } from 'lucide-react'   // add to imports

const navItems = [
  // ... existing entries
  { icon: Users, label: 'Members', href: '/members', active: true },   // NEW
]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `supabase.auth.signInWithOAuth` from server action with manual `code_verifier` cookie | Client-side `signInWithOAuth` + `@supabase/ssr` automatic PKCE handling | `@supabase/ssr@0.10+` (2025) | Phase 42 uses the modern path — no manual PKCE. |
| Storing `GOOGLE_CLIENT_ID/SECRET` in app env vars | Configure in Supabase Dashboard → Auth → Providers | Supabase Auth GA (2023+) | Phase 42 has zero new env vars. |
| Implicit flow with `#access_token` URL fragment | PKCE / auth-code flow with `?code=` query + server-side exchange | Supabase default since v2 (2023) | Phase 42 uses code flow exclusively. |

**Deprecated/outdated:**
- `auth-helpers-nextjs` package — replaced by `@supabase/ssr`. Operator already on `@supabase/ssr@0.10.3` — nothing to migrate.

## Open Questions

1. **Atomic membership-creation across multi-org invites (Pitfall 5).**
   - What we know: Loop over invites in JS is not transactional.
   - What's unclear: Worth the complexity of a Postgres `accept_invites(email)` function?
   - Recommendation: **Ship the JS loop in v1** — the failure mode (one invite UPDATE fails after the membership INSERT succeeds) is recoverable on re-login because the `upsert` is idempotent and the still-pending invite would be re-processed. Document the edge case in a code comment. If observed in practice, migrate to a stored procedure in a follow-up.

2. **Role change UI in Members page (CONTEXT Open Question #4).**
   - What we know: D-42-09 locks the roles to `admin`/`member`. Add/remove flows are spec'd.
   - What's unclear: Does the page also let admins toggle member.role admin↔member?
   - Recommendation: **YES — include role dropdown per row.** It is 20 LOC and avoids a "v1 ships incomplete" complaint. Server action: `updateMemberRole(member_id, role)`. RLS already covers it because `org_members` UPDATE is RLS-scoped to current org.

3. **"Last admin" protection.**
   - What we know: D-42-12 allows admins to remove any member, including themselves.
   - What's unclear: If the last admin removes themselves or demotes themselves to member, the org becomes unmanageable.
   - Recommendation: Server action `removeMember` and `updateMemberRole` should reject if the action would leave zero admins. Cheap `SELECT COUNT(*) FROM org_members WHERE org_id=... AND role='admin' AND user_id != $target`. Surface friendly error: "Cannot remove the last admin. Promote another member first."

4. **Sidebar placement (CONTEXT Open Question #3).**
   - What we know: Current sidebar has Settings as a footer-dropdown item, not a nav item. Top-level nav items are: Dashboard, Phone, Tools, Agents, Knowledge, Integrations, Chat, Reviews.
   - What's unclear: Members alongside these as a top-level nav, or under the footer dropdown?
   - Recommendation: **Top-level nav entry** with `Users` icon, placed after `Integrations`. Members management is a routine task; burying it in the user-menu adds clicks. CONTEXT.md agrees with this recommendation.

5. **Existing `tests/auth.test.ts` is `it.todo` stubs — does Phase 42 land real tests?**
   - What we know: AUTH-01/-03/-05 already have test stubs from v1.0 that were never implemented.
   - What's unclear: Whether Phase 42 should write the originally-planned email/password tests (AUTH-06 regression coverage) on top of the new Google tests.
   - Recommendation: **Yes — convert `tests/auth.test.ts` stubs to real tests as part of Phase 42 AUTH-06.** Zero excuse to ship Google SSO without a regression test for the path it's coexisting with.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (Next.js 16) | runtime='nodejs' callback | ✓ | per project | — |
| `@supabase/ssr` | OAuth code exchange + cookie mgmt | ✓ | 0.10.3 | — |
| `@supabase/supabase-js` | `signInWithOAuth`, `signOut` | ✓ | 2.105.4 | — |
| Supabase project | Auth provider + DB | ✓ | hosted | — |
| Google Cloud Console OAuth client | OAuth provider | ✗ (HUMAN-UAT) | — | **None — blocks production.** Captured in HUMAN-UAT. |
| Email delivery (Resend/SendGrid) | NOT required v1 | ✗ | — | D-42-07: manual link share is the v1 fallback. |
| `npx supabase db push` | Applying migration 045 | ✓ | per project (operator runs manually) | — |
| `npm run build` | Type-check gate | ✓ | per project (`next build` is the type gate; `next lint` is broken — see STATE.md tech-debt note) | — |

**Missing dependencies with no fallback:**
- Google Cloud Console OAuth client creation — HUMAN-UAT step. Phase 42 ships **code-complete** with this still pending; first prod login attempt fails until HUMAN-UAT done.

**Missing dependencies with fallback:**
- Invite email automation — manual link share covers v1.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@^4.1.2` (already installed) |
| Config file | `vitest.config.ts` (Node env, globals, `tests/**/*.test.{ts,tsx}` include) |
| Quick run command | `npx vitest run tests/auth/` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Google provider config (Supabase Dashboard) | manual-only | HUMAN-UAT in `42-HUMAN-UAT.md` | ❌ Wave 0 (UAT doc) |
| AUTH-01 | `signInWithOAuth` redirects to Google with correct `redirectTo` | unit | `npx vitest run tests/auth/google-signin-button.test.ts` | ❌ Wave 0 |
| AUTH-01 | Callback exchanges code for session | integration | `npx vitest run tests/auth/oauth-callback.test.ts` | ❌ Wave 0 |
| AUTH-02 | `org_invites` table exists with RLS + indexes | integration (Postgres schema introspection) | `npx vitest run tests/auth/org-invites-schema.test.ts` | ❌ Wave 0 |
| AUTH-02 | Admin-only INSERT enforced by RLS | integration (cross-user RLS via service-role seeded users) | `npx vitest run tests/auth/rls.test.ts` | ❌ Wave 0 (extend `tests/rls-isolation.test.ts` pattern) |
| AUTH-03 | Callback rejects not-invited email + redirects + signs out | integration | `npx vitest run tests/auth/oauth-callback.test.ts::not_invited` | ❌ Wave 0 |
| AUTH-03 | Callback creates `org_members` + marks accepted | integration | `npx vitest run tests/auth/invite-reconciler.test.ts` | ❌ Wave 0 |
| AUTH-04 | `/login` page renders Google button above form | unit (React Testing Library) | `npx vitest run tests/auth/login-page.test.tsx` | ❌ Wave 0 |
| AUTH-05 | `inviteByEmail` / `revokeInvite` / `removeMember` server actions | unit | `npx vitest run tests/auth/invite-actions.test.ts` | ❌ Wave 0 |
| AUTH-06 | Email/password `signInWithPassword` still works | integration | `npx vitest run tests/auth.test.ts` (convert existing `it.todo`) | ✅ exists as stubs |
| AUTH-07 | Multi-org: 2 invites → 2 memberships | integration | `npx vitest run tests/auth/invite-reconciler.test.ts::multi_org` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/auth/`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` green AND `npm run build` exit 0 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/auth/oauth-callback.test.ts` — covers AUTH-01, AUTH-03
- [ ] `tests/auth/invite-reconciler.test.ts` — covers AUTH-03, AUTH-07 (extract reconciliation into `lib/auth/invite-reconciler.ts` so it's unit-testable without an actual OAuth round trip)
- [ ] `tests/auth/invite-actions.test.ts` — covers AUTH-02, AUTH-05
- [ ] `tests/auth/rls.test.ts` — covers AUTH-02 (cross-org isolation; extend `tests/rls-isolation.test.ts` patterns)
- [ ] `tests/auth/org-invites-schema.test.ts` — schema introspection (table + indexes + policies present)
- [ ] `tests/auth/login-page.test.tsx` — RTL snapshot of `/login` with Google button
- [ ] `tests/auth/google-signin-button.test.ts` — verify `redirectTo` includes `/auth/callback` and current origin
- [ ] Convert `tests/auth.test.ts` `it.todo` to real tests (AUTH-06 regression)
- [ ] `42-HUMAN-UAT.md` — Google Cloud Console + Supabase Dashboard setup checklist

*(Note: existing `tests/setup/load-env.ts` setup file is reused; no new test framework needed.)*

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/001_foundation.sql` (read 168 lines) — verified `org_members.role` already exists with `public.user_role` enum
- `supabase/migrations/007_org_switcher.sql` (read 100 lines) — verified `get_current_org_id()` SECURITY DEFINER pattern + `user_active_org` table + `vo_active_org` cookie idiom
- `supabase/migrations/044_agents_generation_config.sql` — verified latest migration number = 044 (next = 045)
- `src/lib/supabase/server.ts` — verified `cache()` helpers pattern
- `src/lib/supabase/admin.ts` — verified `createServiceRoleClient()` exists with proper warnings
- `src/app/api/auth/callback/route.ts` — existing generic Supabase OAuth callback (template for new `/auth/callback`)
- `src/app/(dashboard)/organizations/actions.ts` — verified `setActiveOrgCookie`, `user_active_org` upsert, and the service-role-for-new-user pattern
- `src/app/(dashboard)/layout.tsx` — verified `vo_active_org` cookie consumption (load-bearing for the JSON shape)
- `src/app/(auth)/login/page.tsx` — verified current login flow is `'use client'` + `signInWithPassword`
- `src/components/layout/app-sidebar.tsx` — verified `navItems` structure for adding Members entry
- `src/types/database.ts` lines 75-108 — verified `org_members` types include `role: UserRole`
- `package.json` — verified versions: `@supabase/ssr@^0.10.0`, `@supabase/supabase-js@^2.101.1`, `next@^16.2.2`, `react-hook-form@^7.72.0`, `zod@^3.25.76`
- `vitest.config.ts` — verified test framework + setup files
- `.planning/config.json` — verified `workflow.nyquist_validation: true`
- `npm view @supabase/ssr version` → 0.10.3 (matches installed range)
- `npm view @supabase/supabase-js version` → 2.105.4 (matches installed range)
- [Supabase docs: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google) — canonical PKCE pattern verified against existing `/api/auth/callback/route.ts`

### Secondary (MEDIUM confidence)
- [Supabase docs: PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow) — confirms `@supabase/ssr` handles `code_verifier` cookie automatically; 5-minute code TTL; single-use
- [Supabase docs: Server-side auth advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide) — confirms route handler pattern + `exchangeCodeForSession` API
- WebSearch corroboration on PKCE flow specifics (multiple 2024-2025 articles agree on the pattern shown above)

### Tertiary (LOW confidence)
- None — all critical claims verified against either the actual Operator codebase OR official Supabase docs.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all dependencies already installed and registry-version-verified.
- Architecture: **HIGH** — three reference implementations of the patterns (auth callback, org-with-membership creation, server actions + RLS) already in repo.
- Schema: **HIGH** — `org_members.role` existence confirmed by reading migration 001.
- Pitfalls: **HIGH (1, 2, 4, 7, 8) / MEDIUM (3, 5, 6, 9)** — 1/2/4/7/8 are direct from reading the existing code paths; 3/5/6/9 are inferred from Supabase docs + general OAuth/multi-org experience.
- Test architecture: **HIGH** — vitest config inspected; reusable test scaffolding (`tests/rls-isolation.test.ts`, `tests/setup/load-env.ts`) confirmed.

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days — Supabase Auth API is stable; Next.js 16 + `@supabase/ssr` 0.10 line is the current stable release)

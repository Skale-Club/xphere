---
plan: 42-03
status: complete
completed: 2026-05-16
commit: 8bf54fb
---

# Plan 42-03 Summary: OAuth Callback Route + Login Page Update

## What Was Built

Created the OAuth callback route that enforces the org_invites allowlist, and added the "Sign in with Google" button to the login page.

## Key Files Created/Modified

- `src/app/auth/callback/route.ts` — OAuth callback with allowlist enforcement
- `src/app/(auth)/login/page.tsx` — Added Google sign-in button + error display

## Decisions

- Used inline Google "G" SVG logo instead of lucide-react `Chrome` icon (not available in project's lucide-react version)
- Email normalization uses `.toLowerCase().trim()` to match `idx_org_invites_email` (lower(email))
- Un-invited users get redirected to `/login?error=not_invited` — auth.users row exists but no org_members row, so no data access
- URL error params read with `window.location.search` (SSR-safe with typeof window check)

## Self-Check: PASSED

- [x] /auth/callback route created with Node.js runtime
- [x] exchangeCodeForSession called for code exchange
- [x] Email normalized with .toLowerCase().trim()
- [x] .is('accepted_at', null) in invite query (only pending)
- [x] Redirects to /login?error=not_invited when no invite
- [x] Upserts org_members with onConflict: 'user_id,organization_id'
- [x] Sets vo_active_org cookie with JSON.stringify({ id, name })
- [x] Updates invite.accepted_at after acceptance
- [x] Google sign-in button triggers signInWithOAuth({ provider: 'google' })
- [x] redirectTo uses process.env.NEXT_PUBLIC_SITE_URL
- [x] Original signInWithPassword form unchanged
- [x] Build passes

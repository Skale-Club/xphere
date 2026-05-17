# Phase 42: Google SSO — Requirements

**Source:** SEED-003-google-sso-admin-auth.md + operator decisions 2026-05-16

---

## AUTH-01 — Google Sign-In Button on Login Page

The `/login` page MUST display a "Sign in with Google" button above the existing email/password form, separated by an "or" divider. Clicking initiates Supabase OAuth flow with `provider: 'google'` and `redirectTo: process.env.NEXT_PUBLIC_SITE_URL + '/auth/callback'`.

## AUTH-02 — OAuth Callback Route

`/auth/callback` route handler MUST:
1. Exchange the OAuth code for a session via `supabase.auth.exchangeCodeForSession(code)`
2. Normalize the user's email (lowercase + trim)
3. Query `org_invites` for any pending invite matching that email
4. If NO invite found: redirect to `/login?error=not_invited` (do NOT create membership)
5. If invite found: create `org_members` row, mark `org_invites.accepted_at = now()`, set `vo_active_org` cookie, redirect to `/`

## AUTH-03 — Allowlist Enforcement (org_invites table)

`org_invites` table MUST exist with columns: `id UUID PK`, `org_id UUID FK organizations`, `email TEXT NOT NULL`, `role user_role NOT NULL DEFAULT 'member'`, `invited_by UUID FK auth.users`, `invited_at TIMESTAMPTZ DEFAULT now()`, `accepted_at TIMESTAMPTZ NULL`, `expires_at TIMESTAMPTZ NULL`. RLS: only admin of the org can SELECT/INSERT/DELETE/UPDATE rows for their org.

## AUTH-04 — Members Management Page

`/dashboard/members` page MUST allow org admins to:
- View list of current members (from `org_members` joined with `auth.users`)
- View list of pending invites (from `org_invites WHERE accepted_at IS NULL`)
- Invite a new member (email + role) → inserts row in `org_invites`
- Revoke a pending invite → deletes `org_invites` row
- Remove a current member → deletes `org_members` row

## AUTH-05 — Multi-Org Support

Same email MUST be invitable by multiple orgs independently. A user who accepts invites from 2 orgs gets 2 `org_members` rows and both appear in the OrgSwitcher. `get_user_org_ids()` function (already in migration 007) handles this correctly.

## AUTH-06 — Email/Password Regression Protection

Existing `signInWithPassword` flow MUST continue to work without modification. The Google Sign-In button is additive — no existing auth code is removed or modified.

## AUTH-07 — RLS Isolation

All `org_invites` RLS policies MUST use `(SELECT public.get_current_org_id())` pattern (not direct org_id comparison) for performance. Cross-org reads/writes MUST be refused by RLS. A user may not see or modify invites from an org they don't belong to.

---

## Locked Decisions (from SEED-003)

| Decision | Value | Rationale |
|----------|-------|-----------|
| Coexistence | Google **additional** to email/password | Zero risk to existing users |
| Restriction | Allowlist per org (`org_invites` table) | Multi-tenant; not domain-based |
| Scope | Dashboard admin only | Widget remains anonymous |
| MFA | Not implemented | Trust Google 2FA |
| Membership table | Use existing `org_members` (migration 001) | Already has RLS + `user_id`/`organization_id` schema |
| Email normalization | lowercase + trim | Prevent case-mismatch blocking |
| Invite email | Not sent (admin shares link manually) | Reduces scope; no SendGrid dependency |
| Role granularity | `admin` \| `member` (existing `user_role` enum) | Already in schema |
| Invite expiration | No expiration (nullable `expires_at`) | Simple MVP |

## Out of Scope

- MFA (TOTP, WebAuthn)
- Google Workspace domain restriction
- Magic link / passwordless email
- GitHub / Microsoft / Apple OAuth
- Widget SSO
- SCIM / SAML enterprise SSO
- Audit log of logins
- Invite email via SendGrid/Resend

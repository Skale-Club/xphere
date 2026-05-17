# Phase 42: Google SSO for Admin Dashboard — Roadmap

**Milestone:** v2.1-google-sso (standalone, independent of v2.0 phases 37-41)
**Goal:** Add Google Sign-In as an additional auth option for the admin dashboard with per-org allowlist enforcement.

---

## Phase 42: Google SSO — Admin Dashboard Auth

**Status:** Planned
**Depends on:** None

**Goal:** Add Google Sign-In as an additional authentication option for admin dashboard (coexists with existing email/password). Restrict access via per-org allowlist (`org_invites` table) — admin invites email, first OAuth login of invited email auto-creates membership. Multi-org friendly. No own MFA (trust Google 2FA).

**Source of decisions:** `.planning/seeds/SEED-003-google-sso-admin-auth.md`

**Requirements:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07

**Success Criteria:**
1. `/login` shows a "Sign in with Google" button above the existing email/password form; clicking it redirects through Google OAuth and back to `/dashboard` for invited emails
2. Email NOT in any `org_invites` row is blocked at the OAuth callback with redirect to `/login?error=not_invited` (no membership is granted)
3. First OAuth login of an invited email creates the `org_members` row + marks `org_invites.accepted_at` + sets cookie `vo_active_org`
4. Admin at `/dashboard/members` can: list current members, list pending invites, invite a new member (email + role), revoke a pending invite, and remove a current member
5. Multi-org: same email invited in 2 orgs gets 2 memberships; OrgSwitcher shows both
6. Existing email/password login flow continues to work byte-identically (no regression)
7. RLS isolates `org_invites` and `org_members` per org; cross-org reads/writes refused

### Sub-plans

| Plan | Description |
|------|-------------|
| 42-01-PLAN.md | Migration 045 (org_invites table) + remote DB push + types regen |
| 42-02-PLAN.md | Pre-flight: Google Cloud Console + Supabase Dashboard + Vercel env var config |
| 42-03-PLAN.md | OAuth callback route + email normalizer + /login Google button |
| 42-04-PLAN.md | /dashboard/members page (server actions, table, invite modal, sidebar entry) |
| 42-05-PLAN.md | Tests: unit + integration invite flow + RLS isolation + email/password regression |

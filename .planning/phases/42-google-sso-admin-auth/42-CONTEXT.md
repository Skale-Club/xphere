---
phase: 42
name: Google SSO + Team Invites (Admin Auth)
milestone: v2.0 (interim, post-Phase 36)
status: planning
discuss_completed: 2026-05-16
source: .planning/seeds/SEED-003-google-sso-admin-auth.md (decisions pre-locked in seed)
---

# Phase 42: Context + Locked Decisions

## Phase Boundary

Add Google Sign-In as an **additional** authentication option for admin dashboard (coexists with existing email/password). Restrict access via per-org allowlist (`org_invites` table) — admin invites email, first OAuth login of invited email auto-creates `auth.users` + `memberships`. Multi-org friendly. No own MFA (trust Google's 2FA). Widget remains anonymous (out of scope).

**Source of truth:** `.planning/seeds/SEED-003-google-sso-admin-auth.md` — all top-level decisions captured there with operator approval (2026-05-16).

## Requirements in Scope

7 new requirements (defined inline since SSO is not in the v2.0 REQUIREMENTS.md):

- **AUTH-01:** `/login` shows "Sign in with Google" button above existing email/password form (additive, both flows continue to work)
- **AUTH-02:** New `org_invites(id, org_id, email, role, invited_by, invited_at, accepted_at, expires_at)` table with RLS (only org admins can SELECT/INSERT/DELETE their org's rows)
- **AUTH-03:** New `memberships(user_id, org_id, role, created_at)` table OR confirm existing one — verify in research; populate via OAuth callback when allowlist match found
- **AUTH-04:** OAuth callback at `src/app/auth/callback/route.ts` — Supabase OAuth handler; matches `auth.users.email` against `org_invites`; on match → creates membership + marks invite accepted + sets `vo_active_org` cookie; on miss → redirects `/login?error=not_invited`
- **AUTH-05:** `/dashboard/members` page (admin-only) — list current members, list pending invites, invite new member form (email + role), revoke invite, remove member actions; reuses dashboard table pattern
- **AUTH-06:** Multi-org support — same email in two `org_invites` rows → both memberships created → existing `OrgSwitcher` shows both via `user_active_org` + `vo_active_org` cookie pattern
- **AUTH-07:** RLS isolation — cross-org SELECT/INSERT/UPDATE/DELETE on `org_invites` and `memberships` refused; integration test covers it

## Out of Scope (Phase 42 boundary — do not implement)

- MFA / 2FA / TOTP / WebAuthn → trust Google 2FA; future seed if needed
- Google Workspace domain restriction (e.g. only `@company.com`) → use allowlist instead; can layer on later
- Magic link / passwordless email → different provider; not in scope
- GitHub / Microsoft / Apple OAuth → other providers; future seeds
- Widget SSO (end-user identification in chat widget) → widget stays anonymous
- SCIM / SAML enterprise SSO → milestone-sized if a client requires it
- Audit log of logins → can be added later as observability concern
- Email-sending automation for invites (SendGrid/Resend) → see D-42-06; defer to manual link sharing for v1 unless trivial

## Locked Decisions

### D-42-01: Google Sign-In is ADDITIONAL (not replacement)
Existing email/password login continues to work byte-identically. The `/login` page adds a "Sign in with Google" button ABOVE the email/password form with a clear visual divider. Users migrate at their own pace.

**Rationale:** Zero risk of locking out existing users. Migration path is voluntary.

### D-42-02: Allowlist Model = per-org `org_invites` table
Each org maintains its own allowlist of emails. Not domain-restricted. Not "any Google account + approval". The first OAuth login of an email present in `org_invites` automatically creates the user + membership; emails not in any allowlist are blocked with a clear error message.

**Schema:**
```sql
CREATE TABLE org_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  UNIQUE (org_id, email)
);
```

Normalized email storage: lowercase + trim before INSERT.

### D-42-03: Scope = admin dashboard ONLY
Widget continues anonymous. No SSO in `/chat/[token]` or any other public-facing surface. Auth changes are confined to `src/app/(auth)/`, `src/app/auth/callback/`, and `src/app/(dashboard)/members/`.

### D-42-04: No MFA — trust Google's 2FA
Operator does NOT implement TOTP, WebAuthn, or any own second factor. Users who want 2FA enable it inside their Google account. This is the industry-standard pattern for small-to-mid SaaS apps using OAuth.

### D-42-05: Email normalization — lowercase + trim
`org_invites.email` stored lowercase + trimmed on INSERT. OAuth callback normalizes `auth.users.email` the same way before lookup. Prevents `John@Example.com` ≠ `john@example.com` mismatches.

### D-42-06: Invite email sending — manual link in v1
Admin invites a member → row created in `org_invites` → admin manually shares `/login` URL with the invitee. NO automated email via SendGrid/Resend in Phase 42 (would add a new vendor + infrastructure for marginal benefit). If real friction emerges post-launch, add email automation as a follow-up.

**Rationale:** Avoid pulling in a new email vendor for v1. Operator already has admin Slack/email channels for invite coordination.

### D-42-07: Role granularity — `admin` and `member` only
Two roles for v1: `admin` (full CRUD on org resources) and `member` (read + own resources). NOT `editor` / `viewer` / etc. Granular role-based perms can come later if needed.

### D-42-08: Invite expiration — 7 days default, configurable per invite
`expires_at` defaults to `now() + 7 days` at INSERT. Admin can override (longer or shorter) at invite time. Expired invites are filtered out at OAuth callback (treated as "not invited"). Admin can extend expiration via "Resend invite" action.

### D-42-09: Membership revocation — hard delete + session invalidation
"Remove member" deletes the `memberships` row immediately. Next page load triggers RLS denial → user is logged out. NO session purge service-side (would require Supabase admin API call). For sensitive removal scenarios, admin can also rotate Supabase JWT secret (manual). v1 trade-off acknowledged.

### D-42-10: Multi-org support reuses existing OrgSwitcher
The current `OrgSwitcher` component already handles multi-membership users via `user_active_org` table + `vo_active_org` cookie. Phase 42 just populates membership rows correctly — zero new UI for org selection.

### D-42-11: First org creation NOT in scope
Phase 42 assumes orgs already exist. Creating the first org of a brand-new Operator install remains a manual SQL provisioning step (existing process). Auto-create-on-first-Google-login is a future concern.

### D-42-12: Migration numbering
Phase 42 adds migration `045_org_invites_and_memberships.sql` (next after `044_agents_generation_config.sql` from Phase 36). Single migration covers both `org_invites` AND `memberships` (if not already present). Includes RLS policies using canonical `(SELECT public.get_current_org_id())` pattern.

### D-42-13: Supabase Auth Google provider configuration
Operator runs `npx supabase` CLI or uses the Supabase Dashboard to enable Google OAuth. Required env vars (added to Vercel + `.env.example`):
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (public — used by browser-side OAuth start)
- Supabase project already holds the Google OAuth secret via Dashboard config (not exposed in env)
- OAuth redirect URI in Google Cloud Console: `https://<supabase-project>.supabase.co/auth/v1/callback` (Supabase handles this internally) → then redirects to `https://operator.skale.club/auth/callback`

The Phase 42 plan includes a checkpoint:human-action step where operator configures Google Cloud Console + Supabase Dashboard before merge.

### D-42-14: OAuth callback runs in Node.js runtime
`src/app/auth/callback/route.ts` declares `export const runtime = 'nodejs'` (matches existing pattern). Uses cached `createClient()` from `src/lib/supabase/server.ts`. Never calls `supabase.auth.getUser()` directly — uses `getUser()` cached helper.

### D-42-15: `/dashboard/members` page reuses dashboard table pattern
Same shape as `/dashboard/agents` and `/dashboard/tools`:
- Server component page reads `getMembers()` + `getPendingInvites()`
- Client component table with shadcn/ui primitives
- "Invite member" button → modal with email + role form (react-hook-form + zod)
- "Revoke" / "Remove" actions trigger server actions
- `revalidatePath('/dashboard/members')` after mutations

Sidebar entry: add "Members" between "Agents" and "Settings" with `users` icon from lucide-react.

## Existing Code Patterns to Reuse

| Pattern | Source |
|---|---|
| Cached auth helpers | `src/lib/supabase/server.ts` — `createClient`, `getUser` |
| `/login` page structure | `src/app/(auth)/login/` |
| Dashboard table CRUD | `src/app/(dashboard)/agents/`, `src/app/(dashboard)/tools/` |
| Sidebar nav entry | `src/components/layout/app-sidebar.tsx` |
| RLS canonical policy | `(SELECT public.get_current_org_id())` template across all v1.x migrations |
| OrgSwitcher multi-org | `src/components/layout/OrgSwitcher.tsx` |
| Server actions + zod | Phase 36 `actions.ts` files |

## Key Files (created/modified in Phase 42)

| File | Purpose |
|---|---|
| `supabase/migrations/045_org_invites_and_memberships.sql` | New tables + RLS |
| `src/types/database.ts` | Add types for new tables (manual edit per project pattern) |
| `src/app/(auth)/login/page.tsx` | Add "Sign in with Google" button + visual divider |
| `src/app/auth/callback/route.ts` | NEW — OAuth callback handler, allowlist matching, membership creation |
| `src/app/(dashboard)/members/page.tsx` | NEW — list members + pending invites |
| `src/app/(dashboard)/members/actions.ts` | NEW — server actions: `getMembers`, `getPendingInvites`, `inviteMember`, `revokeInvite`, `removeMember` |
| `src/components/members/members-table.tsx` | NEW — client table component |
| `src/components/members/invite-member-dialog.tsx` | NEW — invite modal with form |
| `src/components/layout/app-sidebar.tsx` | Modify — add "Members" nav entry |
| `src/lib/auth/normalize-email.ts` | NEW — lowercase + trim helper |
| `src/lib/auth/zod-schemas.ts` | NEW — invite + role schemas |
| `.env.example` | Add `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` placeholder |
| `tests/auth/invite-flow.test.ts` | NEW — integration test for invite → callback → membership |
| `tests/auth/rls.test.ts` | NEW — cross-org isolation test |

## Test Strategy

- **Unit:** zod schemas (email normalization, role validation, invite shape)
- **Integration:**
  - Create org_invites row → simulate OAuth callback with matching email → assert membership row created + invite marked accepted
  - OAuth callback with non-matching email → assert redirect to `/login?error=not_invited` + no membership created
  - Multi-org: same email in 2 org_invites → 2 memberships created → OrgSwitcher shows both
  - RLS: org A cannot SELECT org B's invites or memberships
- **Regression:** existing email/password login tests still pass (must verify on Phase 42 exit)

## Pre-Execution Checklist (Operator manual steps — checkpoint:human-action)

Before Phase 42 plan execution begins, operator must complete:
1. Create Google Cloud Console OAuth 2.0 Client (Web application type)
   - Authorized redirect URI: `https://<supabase-project>.supabase.co/auth/v1/callback`
   - Save Client ID + Secret
2. Enable Google provider in Supabase Dashboard → Authentication → Providers
   - Paste Client ID + Secret
   - Set "Site URL" = `https://operator.skale.club`
   - Set "Redirect URLs" allowlist includes `https://operator.skale.club/auth/callback`
3. Add `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` env var on Vercel (production + preview)

Phase 42 execution depends on these steps being complete BEFORE the OAuth callback testing.

## Deferred Ideas (NOT Phase 42)

- MFA / TOTP / WebAuthn → separate seed if/when needed
- Workspace domain restriction → can layer on top of allowlist later
- Magic links / passwordless email → different provider, separate seed
- GitHub / Microsoft / Apple OAuth → separate seeds per provider
- Widget SSO → widget stays anonymous
- SCIM / SAML enterprise SSO → milestone-sized when an enterprise client surfaces
- Audit log of logins → observability phase
- Email-sending automation for invites → defer until manual link sharing proves insufficient
- Automatic first-org provisioning on first-login → manual SQL for now
- "Resend invite" feature → may add in v2 of this phase if real demand emerges

---
phase: 42
name: Google SSO + Team Invites (Admin Auth)
milestone: v2.0
status: planning
discuss_completed: 2026-05-16
source: .planning/seeds/SEED-003-google-sso-admin-auth.md
---

# Phase 42: Context + Locked Decisions

## Phase Boundary

Add Google Sign-In as an additional authentication option for the admin dashboard. Coexists with existing email/password (no migration of existing users). Restrict access via per-org allowlist (`org_invites` table) — admin invites email, first OAuth login of invited email auto-creates membership in `org_members`. Multi-org friendly. No own MFA (trust Google 2FA).

**Decision source:** This phase is the direct implementation of SEED-003 (planted 2026-05-16). All 4 high-level decisions in the seed are locked here as D-42-01 through D-42-04.

## Requirements in Scope

| ID | Description |
|---|---|
| AUTH-01 | Google OAuth provider configured in Supabase; OAuth callback route handles redirect; env vars `SUPABASE_AUTH_GOOGLE_CLIENT_ID` + `SUPABASE_AUTH_GOOGLE_SECRET` configured |
| AUTH-02 | `org_invites(id, org_id, email, role, invited_by, invited_at, accepted_at, expires_at)` table with RLS; admin-only INSERT/SELECT/DELETE |
| AUTH-03 | OAuth callback verifies invited email; not-invited emails redirect to `/login?error=not_invited`; invited emails create `org_members` row + mark invite accepted + set `user_active_org` |
| AUTH-04 | `/login` shows "Sign in with Google" button above existing email/password form with divider |
| AUTH-05 | `/dashboard/members` page: list members + pending invites; invite form; revoke pending invite; remove current member |
| AUTH-06 | Existing email/password login continues working byte-identically (no regression) |
| AUTH-07 | Multi-org: same email invited in 2 orgs gets 2 memberships; OrgSwitcher (existing) shows both |

## Out of Scope (Phase 42 boundary — do not implement)

- **Own MFA** (TOTP/WebAuthn) — deferred to future phase if compliance demands it
- **Magic link / passwordless email** — separate auth path; seed if demanded
- **GitHub/Microsoft/Apple OAuth** — only Google in v1
- **Widget SSO** — widget continues anonymous (no CORS/cross-domain work)
- **SCIM/SAML enterprise SSO** — separate milestone if enterprise client appears
- **Google Workspace domain restriction** — superseded by per-org allowlist
- **Audit log of logins** — nice-to-have; defer to Phase 40 observability or later
- **Self-service signup** ("create your org with Google") — admin invites only in v1

---

## Locked Decisions

### D-42-01: Google Sign-In is Additional, Not Replacement

**Decision:** Add Google as an OAuth provider alongside email/password. Existing email/password login (`/login` form) continues unchanged. Users can switch between methods freely.

**Why:** Zero risk of breaking existing users. Migration is gradual — operators recommend Google for new admins; existing admins migrate when they want to. Per SEED-003.

### D-42-02: Per-Org Allowlist (Not Domain Restriction)

**Decision:** Each org maintains its own list of invited emails via `org_invites` table. Email NOT in any `org_invites` row is refused at OAuth callback.

**Schema:**
```sql
CREATE TABLE org_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by    UUID NOT NULL REFERENCES auth.users(id),
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at   TIMESTAMPTZ NULL,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  UNIQUE (org_id, email)
);
CREATE INDEX idx_org_invites_email ON org_invites(email) WHERE accepted_at IS NULL;
```

**Why:** Operator is multi-tenant; multiple orgs may have users from same domain. Allowlist gives explicit control per org. Avoids the "Workspace SSO doesn't fit personal Gmail" trap.

### D-42-03: Dashboard Admin Only (Widget Stays Anonymous)

**Decision:** Google Sign-In only applies to `/login` (dashboard auth). The web widget at `/api/chat/[token]` continues to accept anonymous visitors with no auth.

**Why:** Adding SSO to widget introduces CORS/cross-domain complexity for zero practical benefit (visitors don't want to log in to chat). Phase boundary stays small.

### D-42-04: No Own MFA — Trust Google's 2FA

**Decision:** Operator does NOT implement TOTP or WebAuthn. Users who want 2FA enable it on their Google account.

**Why:** The seed estimated MFA as separate milestone scope. Google's 2FA is widely adopted (Google Authenticator, hardware keys, push notifications) and covers the dominant threat (credential stuffing). Skipping own MFA keeps this phase focused.

### D-42-05: Use Existing `org_members` Table (Not New `memberships`)

**Decision:** The seed mentioned `memberships(user_id, org_id, role)` but the actual schema uses `org_members` (created in migration 007). Phase 42 uses `org_members` — do not introduce a new table.

**Verification:** `supabase/migrations/007_org_switcher.sql` line 51-52 — `org_members(user_id, organization_id)` is the canonical table.

**Schema check:** Need to confirm `org_members` has a `role` column. If not, add it via migration 045.

### D-42-06: OAuth Callback Lives at `/auth/callback`

**Decision:** Add `src/app/auth/callback/route.ts` to handle Supabase OAuth redirect. This is the canonical Supabase + Next.js App Router pattern.

Flow:
1. User clicks "Sign in with Google" on `/login`
2. Browser redirected to Google consent screen
3. Google redirects back to `https://operator.skale.club/auth/callback?code=XXX`
4. Callback route exchanges code for session via `supabase.auth.exchangeCodeForSession()`
5. After session created, callback queries `org_invites WHERE email = $session_email AND accepted_at IS NULL AND expires_at > now()`
6. If no rows: sign user out + redirect to `/login?error=not_invited`
7. If 1+ rows: for each row, INSERT into `org_members(user_id, organization_id, role)`, UPDATE invite `accepted_at = now()`. Set `user_active_org` to first org. Redirect to `/dashboard`.

### D-42-07: Invite Email Delivery — Deferred (Manual Link Share in v1)

**Decision:** v1 does NOT send invite emails automatically. Admin invites the email via UI; admin shares the `https://operator.skale.club/login` URL manually (via Slack/email/whatever).

The invite email automation (Resend/SendGrid integration) is captured as an Open Question for future enhancement.

**Why:** Email delivery is a separate integration with its own credentials, error handling, deliverability concerns. Phase 42 ships the schema + UI; email delivery is a small follow-up.

### D-42-08: Invite Expiration = 30 Days

**Decision:** `expires_at` defaults to `now() + INTERVAL '30 days'`. Expired invites are filtered out at callback (`WHERE expires_at > now()`). Expired invites show in `/dashboard/members` UI with a "Re-send" button that updates `expires_at = now() + INTERVAL '30 days'`.

### D-42-09: Role Granularity = `admin` and `member`

**Decision:** Two roles only — `admin` (can manage members, settings, all data) and `member` (read + edit data, cannot manage team). Stored on both `org_invites.role` and `org_members.role` (if column added).

More granular roles (editor, viewer, billing-only) deferred until first real demand.

### D-42-10: Email Matching = Normalized (lowercase + trim)

**Decision:** All emails stored lowercased + trimmed. Both at INSERT (in `inviteByEmail` server action) and at callback lookup. Prevents case mismatch (`Admin@x.com` vs `admin@x.com`) creating phantom non-matches.

### D-42-11: First Login Creates Membership; Subsequent Logins Just Sign In

**Decision:** The OAuth callback only INSERTs into `org_members` on the first successful login (when `accepted_at IS NULL`). Subsequent logins of the same email just create a Supabase session and redirect to `/dashboard` — no double-INSERT.

### D-42-12: Revocation Flow

**Decision:**
- **Revoke pending invite** (not yet accepted): `DELETE FROM org_invites WHERE id = $invite_id`. The email can no longer use that invite to log in.
- **Remove current member**: `DELETE FROM org_members WHERE org_id = $org_id AND user_id = $user_id`. User's existing sessions remain valid until they expire (Supabase Auth session TTL), but they can no longer access the org's data because RLS checks membership. **No active session invalidation in v1** — sessions die naturally on TTL or page refresh after membership removal.

### D-42-13: Auth Callback is `runtime = 'nodejs'`

**Decision:** `src/app/auth/callback/route.ts` declares `export const runtime = 'nodejs'` to match the rest of the auth/API code (CLAUDE.md compliance).

### D-42-14: RLS Policies Use Canonical Pattern

**Decision:** `org_invites` uses the same `organization_id = (SELECT public.get_current_org_id())` pattern as every other org-scoped table. Only role='admin' members can INSERT/DELETE (enforced in server action AND/OR RLS — TBD by planner).

---

## Existing Code Patterns to Reuse

| Pattern | Source |
|---|---|
| Cached auth helpers | `src/lib/supabase/server.ts` — `createClient()`, `getUser()` |
| `org_members` table | `supabase/migrations/007_org_switcher.sql` |
| `user_active_org` cookie pattern | `supabase/migrations/007_org_switcher.sql` |
| `get_user_org_ids()` helper (SECURITY DEFINER) | migration 007 |
| Login page | `src/app/(auth)/login/` |
| Org switcher UI | `src/components/layout/OrgSwitcher.tsx` |
| Sidebar nav entry | `src/components/layout/app-sidebar.tsx` |
| Server actions + zod | `src/app/(dashboard)/agents/actions.ts` (Phase 36 reference) |
| Server actions + react-hook-form | `src/components/agents/agent-form.tsx` (Phase 36 reference) |

## Key Files (created/modified in Phase 42)

| File | Change |
|---|---|
| `supabase/migrations/045_org_invites.sql` | NEW — `org_invites` table + RLS + index; also ALTER `org_members ADD COLUMN role TEXT` if missing |
| `src/app/auth/callback/route.ts` | NEW — OAuth callback handler |
| `src/app/(auth)/login/page.tsx` | MODIFY — add "Sign in with Google" button + divider |
| `src/app/(auth)/login/google-signin-button.tsx` | NEW — client component triggers `signInWithOAuth` |
| `src/app/(dashboard)/members/page.tsx` | NEW — members + invites management page |
| `src/app/(dashboard)/members/actions.ts` | NEW — server actions: listMembers, listInvites, inviteEmail, revokeInvite, removeMember, resendInvite |
| `src/components/members/members-table.tsx` | NEW |
| `src/components/members/invites-table.tsx` | NEW |
| `src/components/members/invite-form.tsx` | NEW |
| `src/components/layout/app-sidebar.tsx` | MODIFY — add "Members" entry under settings |
| `src/lib/auth/zod-schemas.ts` | NEW — invite email + role schema |
| `src/types/database.ts` | MODIFY — add `org_invites` type + `org_members.role` if added |
| `tests/auth/oauth-callback.test.ts` | NEW — callback handler tests (invited / not-invited / multi-org) |
| `tests/auth/invite-actions.test.ts` | NEW — server actions tests |
| `tests/auth/rls.test.ts` | NEW — cross-org RLS isolation for `org_invites` |

## Operator-Side Setup (HUMAN-UAT — required before this phase ships)

1. **Google Cloud Console** — create OAuth client:
   - Project: Operator (existing or new)
   - OAuth consent screen: Operator branding (app name, logo, support email)
   - Authorized redirect URIs: `https://<supabase-project>.supabase.co/auth/v1/callback`
   - Authorized JavaScript origins: `https://operator.skale.club`
   - Get Client ID + Client Secret

2. **Supabase Dashboard** — enable Google provider:
   - Authentication → Providers → Google → Enabled
   - Paste Client ID + Client Secret from step 1
   - Save

3. **No env vars needed in Operator** — Supabase Dashboard config is server-side; the SDK uses it automatically.

## Test Strategy

- **Unit:** zod schemas (email normalization, role validation)
- **Integration:**
  - OAuth callback with invited email → membership created + invite marked
  - OAuth callback with non-invited email → blocked + redirect
  - Multi-org: same email invited twice → 2 memberships
  - Re-invitation after revocation works
- **Build gate:** `npm run build` exit 0
- **Regression:** existing email/password tests still pass; existing `org_members` queries unaffected

## Deferred Ideas

- **Invite email automation** (Resend/SendGrid) — separate phase or as v2 polish
- **Self-service org creation** — first Google login creates an org with that user as admin
- **Domain auto-allowlist** — admin opts into "allow any @company.com" (Workspace SSO style) as alternative to per-email
- **Audit log of logins** → Phase 40 observability scope or separate
- **Role granularity beyond admin/member** — editor/viewer/billing-only
- **Session invalidation on member removal** — call `auth.admin.signOut(user_id)` to kill active sessions immediately
- **Magic link login** — passwordless email
- **GitHub/Microsoft/Apple OAuth** — additional providers
- **Own MFA (TOTP/WebAuthn)** — only if compliance demands it

## Open Questions (let planner resolve)

1. Does `org_members` already have a `role` column? If not, migration 045 must add it.
2. Should RLS on `org_invites` restrict INSERT to admin-only via DB policy, or only enforce in server action? (Recommendation: both — defense in depth)
3. Where does "Members" link live in the sidebar? Under "Settings" or as top-level? (Recommendation: top-level "Members" entry near "Settings")
4. Should the Members page also let admins **change roles** of existing members? Or only invite + remove? (Recommendation: yes — role dropdown per row, but only if seed didn't say otherwise)

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types/database'

/**
 * Invite acceptance.
 *
 * WHY SERVICE ROLE: a user accepting an invite is — by definition — not yet a
 * member of the target org. Every RLS policy on `org_invites` / `org_members`
 * requires the caller to ALREADY be an admin/owner of the active org (and
 * `get_current_org_id()` returns NULL for a member-less user), so the
 * authenticated (anon-key) client can neither read the invite nor insert the
 * membership. Acceptance therefore runs through the service role.
 *
 * The authorization boundary is the caller proving ownership of the verified
 * OAuth email the invite was addressed to. The token (see acceptInviteByToken)
 * disambiguates WHICH invite — it is not a standalone bearer credential.
 */

/**
 * Cookie used to carry an invite token across the OAuth login round-trip: when
 * an unauthenticated user clicks a tokenized link, we stash the token here,
 * send them to /login, and the auth callback consumes it after sign-in.
 */
export const PENDING_INVITE_COOKIE = 'pending_invite_token'

/** 256-bit URL-safe invite token (two dash-stripped UUIDs). */
export function generateInviteToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

export type AcceptInviteResult =
  | { status: 'accepted'; orgId: string; orgName: string }
  | { status: 'no-invite' }
  | { status: 'expired' }
  | { status: 'mismatch'; invitedEmail: string }
  | { status: 'error'; message: string }

/**
 * Accept a specific invite identified by its token. Validates expiry and that
 * the authenticated user's email matches the invited address. Idempotent: a
 * re-click on an already-accepted invite still resolves the org.
 */
export async function acceptInviteByToken(
  token: string,
  userId: string,
  email: string,
): Promise<AcceptInviteResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const admin = createServiceRoleClient()

  const { data: invite, error } = await admin
    .from('org_invites')
    .select('id, org_id, role, email, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (error) {
    console.error('[acceptInviteByToken:lookup-failed]', error.message)
    return { status: 'error', message: error.message }
  }
  if (!invite) return { status: 'no-invite' }

  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { status: 'expired' }
  }

  if (invite.email.toLowerCase().trim() !== normalizedEmail) {
    return { status: 'mismatch', invitedEmail: invite.email }
  }

  return finalizeAcceptance(admin, userId, invite.id, invite.org_id, invite.role)
}

/**
 * Email-based fallback used when no token is present (e.g. a fresh OAuth sign-in
 * by an invited user who didn't click the tokenized link). Grabs the most
 * recent pending invite for the verified email.
 */
export async function acceptPendingInvite(
  userId: string,
  email: string,
): Promise<AcceptInviteResult> {
  const normalizedEmail = email.toLowerCase().trim()
  if (!normalizedEmail) return { status: 'no-invite' }

  const admin = createServiceRoleClient()

  const { data: invite, error } = await admin
    .from('org_invites')
    .select('id, org_id, role, expires_at')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)
    .order('invited_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[acceptPendingInvite:lookup-failed]', error.message)
    return { status: 'error', message: error.message }
  }
  if (!invite) return { status: 'no-invite' }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { status: 'expired' }
  }

  return finalizeAcceptance(admin, userId, invite.id, invite.org_id, invite.role)
}

/** Shared write path: create membership, mark accepted, set active org. */
async function finalizeAcceptance(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  inviteId: string,
  orgId: string,
  role: UserRole,
): Promise<AcceptInviteResult> {
  const { error: memberErr } = await admin
    .from('org_members')
    .upsert(
      { user_id: userId, organization_id: orgId, role },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    )

  if (memberErr) {
    console.error('[finalizeAcceptance:member-upsert-failed]', memberErr.message)
    return { status: 'error', message: memberErr.message }
  }

  await admin
    .from('org_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inviteId)

  // Make the joined org active so get_current_org_id() resolves it immediately
  // (otherwise OrgSwitcher shows "Select organization").
  await admin
    .from('user_active_org')
    .upsert({ user_id: userId, organization_id: orgId }, { onConflict: 'user_id' })

  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()

  console.log('[finalizeAcceptance:accepted] user_id=', userId, 'org_id=', orgId)
  return { status: 'accepted', orgId, orgName: org?.name ?? '' }
}

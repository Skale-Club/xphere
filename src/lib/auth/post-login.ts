import 'server-only'
import { cookies } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  acceptInviteByToken,
  acceptPendingInvite,
  PENDING_INVITE_COOKIE,
} from '@/lib/invites/accept'

export const ACTIVE_ORG_COOKIE = 'vo_active_org'

/** Same attributes the old /auth/callback set: the dashboard layout reads it client-side too. */
export const ACTIVE_ORG_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  httpOnly: false,
  maxAge: 60 * 60 * 24 * 30,
}

export type PostLoginOrg =
  | { orgId: string; orgName: string; inviteOutcome: string | null; clearPendingCookie: boolean }
  | { orgId: null; inviteOutcome: string | null; clearPendingCookie: boolean }

/**
 * Which organization a freshly signed-in user lands in. Moved out of the old
 * OAuth callback with its precedence intact:
 *   1. a tokenized invite from the browser's pending-invite cookie,
 *   2. an existing membership, preferring the saved active org,
 *   3. an invite addressed to the user's email.
 *
 * This runs inside the sign-in request, before any session cookie exists, so
 * every read goes through the service role and is filtered by user_id by hand
 * instead of relying on RLS.
 */
export async function resolvePostLoginOrg(userId: string, email: string | null | undefined): Promise<PostLoginOrg> {
  const admin = createServiceRoleClient()
  const normalizedEmail = (email ?? '').toLowerCase().trim()

  let resolvedOrgId: string | null = null
  let resolvedOrgName: string | null = null
  let inviteOutcome: string | null = null
  let clearPendingCookie = false

  // 0) Tokenized invite wins over everything: someone who already belongs to
  //    org A but clicked an invite to org B joins B instead of being silently
  //    routed to A by the membership path below.
  const cookieStore = await cookies()
  const pendingToken = cookieStore.get(PENDING_INVITE_COOKIE)?.value ?? null
  if (pendingToken) {
    clearPendingCookie = true
    const result = await acceptInviteByToken(pendingToken, userId, normalizedEmail)
    if (result.status === 'accepted') {
      resolvedOrgId = result.orgId
      resolvedOrgName = result.orgName
      inviteOutcome = 'joined'
    } else if (result.status === 'mismatch') {
      console.warn('[post-login:token-invite-mismatch] for=', result.invitedEmail)
      inviteOutcome = 'mismatch'
    } else if (result.status === 'expired') {
      inviteOutcome = 'expired'
    } else {
      console.warn('[post-login:token-invite-unresolved]', result.status)
    }
    // Any non-accepted outcome falls through so the user still lands in an org
    // they already belong to.
  }

  // 1) Existing member: no invite needed. Prefer the org they last used, or
  //    the page and the RLS-resolved org would disagree and data pages go empty.
  if (!resolvedOrgId) {
    const { data: membership, error: membershipError } = await admin
      .from('org_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (membershipError) {
      console.error('[post-login:membership-lookup-failed]', membershipError.message)
    }
    resolvedOrgId = membership?.organization_id ?? null

    if (resolvedOrgId) {
      const { data: savedOrg } = await admin
        .from('user_active_org')
        .select('organization_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (savedOrg?.organization_id) resolvedOrgId = savedOrg.organization_id
    }
  }

  // 2) Invite addressed to the user's email, only if nothing resolved yet.
  if (!resolvedOrgId && normalizedEmail) {
    const result = await acceptPendingInvite(userId, normalizedEmail)
    if (result.status === 'accepted') {
      resolvedOrgId = result.orgId
      resolvedOrgName = result.orgName
    } else if (result.status === 'error') {
      console.error('[post-login:invite-accept-failed]', result.message)
    }
  }

  if (!resolvedOrgId) return { orgId: null, inviteOutcome, clearPendingCookie }

  let orgName = resolvedOrgName
  if (!orgName) {
    const { data } = await admin.from('organizations').select('name').eq('id', resolvedOrgId).maybeSingle()
    orgName = data?.name ?? ''
  }
  return { orgId: resolvedOrgId, orgName, inviteOutcome, clearPendingCookie }
}

/**
 * The invite carried by the browser's pending-invite cookie, if it is still
 * usable: unexpired and not yet accepted. Its email is the proof that lets an
 * unknown phone create or claim an account, because the emailed token reached
 * the owner of that address. Read-only; acceptance happens in resolvePostLoginOrg.
 */
export async function readPendingInvite(): Promise<{ email: string } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(PENDING_INVITE_COOKIE)?.value
  if (!token) return null
  const { data, error } = await createServiceRoleClient()
    .from('org_invites')
    .select('email, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle()
  if (error || !data) return null
  if (data.accepted_at) return null
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null
  const email = data.email.toLowerCase().trim()
  return email ? { email } : null
}

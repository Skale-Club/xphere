import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/admin'

/**
 * Consume a pending org invite for a freshly-authenticated user.
 *
 * WHY SERVICE ROLE: a user accepting an invite is — by definition — not yet a
 * member of the target org. Every RLS policy on `org_invites` / `org_members`
 * requires the caller to ALREADY be an admin/owner of the active org (and
 * `get_current_org_id()` returns NULL for a member-less user), so the
 * authenticated (anon-key) client cannot read the invite NOR insert the
 * membership. The authorization check here is the caller proving ownership of
 * the verified email address that the invite was addressed to — that match is
 * the security boundary, performed by the trusted caller before invoking this.
 *
 * Idempotent: re-running for an already-accepted invite is a no-op that still
 * returns the resolved org (membership upsert ignores duplicates).
 */
export type AcceptInviteResult =
  | { status: 'accepted'; orgId: string; orgName: string }
  | { status: 'no-invite' }
  | { status: 'error'; message: string }

export async function acceptPendingInvite(
  userId: string,
  email: string,
): Promise<AcceptInviteResult> {
  const normalizedEmail = email.toLowerCase().trim()
  if (!normalizedEmail) return { status: 'no-invite' }

  const admin = createServiceRoleClient()

  const { data: invite, error: inviteErr } = await admin
    .from('org_invites')
    .select('id, org_id, role')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)
    .order('invited_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (inviteErr) {
    console.error('[acceptPendingInvite:invite-lookup-failed]', inviteErr.message)
    return { status: 'error', message: inviteErr.message }
  }
  if (!invite) return { status: 'no-invite' }

  const { error: memberErr } = await admin
    .from('org_members')
    .upsert(
      { user_id: userId, organization_id: invite.org_id, role: invite.role },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    )

  if (memberErr) {
    console.error('[acceptPendingInvite:member-upsert-failed]', memberErr.message)
    return { status: 'error', message: memberErr.message }
  }

  await admin
    .from('org_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  // Make the newly-joined org the user's active org so get_current_org_id()
  // resolves it immediately (otherwise OrgSwitcher shows "Select organization").
  await admin
    .from('user_active_org')
    .upsert(
      { user_id: userId, organization_id: invite.org_id },
      { onConflict: 'user_id' },
    )

  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', invite.org_id)
    .single()

  console.log('[acceptPendingInvite:accepted] user_id=', userId, 'org_id=', invite.org_id)
  return { status: 'accepted', orgId: invite.org_id, orgName: org?.name ?? '' }
}

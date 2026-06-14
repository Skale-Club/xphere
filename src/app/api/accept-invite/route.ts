import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveRequestOrigin } from '@/lib/site-url'

export const runtime = 'nodejs'

/**
 * GET /api/accept-invite
 *
 * Handles invite acceptance for users who already have an active Supabase
 * session (i.e. they're already logged in when they click "Accept Invitation"
 * in the email, so the OAuth callback never fires and the invite is never
 * consumed via that path).
 *
 * Flow:
 *   - Not authenticated → redirect to /login (OAuth flow handles new-user
 *     invites automatically via /auth/callback)
 *   - Authenticated, pending invite found → create org_members row, set active
 *     org, redirect to /dashboard
 *   - Authenticated, no pending invite → redirect to /dashboard (may already
 *     be a member, or invite expired)
 */
export async function GET(request: Request) {
  const origin = resolveRequestOrigin(request)
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${origin}/login`)
  }

  const normalizedEmail = (user.email ?? '').toLowerCase().trim()

  if (!normalizedEmail) {
    return NextResponse.redirect(`${origin}/dashboard`)
  }

  const { data: invite } = await supabase
    .from('org_invites')
    .select('id, org_id, role')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)
    .limit(1)
    .maybeSingle()

  if (!invite) {
    // No pending invite — user may already be a member or the invite expired.
    return NextResponse.redirect(`${origin}/dashboard`)
  }

  // Create org_members row
  const { error: memberError } = await supabase
    .from('org_members')
    .upsert(
      { user_id: user.id, organization_id: invite.org_id, role: invite.role },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    )

  if (memberError) {
    console.error('[accept-invite:member-upsert-failed]', memberError.message)
    return NextResponse.redirect(`${origin}/dashboard`)
  }

  // Mark invite accepted
  await supabase
    .from('org_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  // Set as the user's active org
  await supabase
    .from('user_active_org')
    .upsert({ user_id: user.id, organization_id: invite.org_id }, { onConflict: 'user_id' })

  // Fetch org name for the cookie
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', invite.org_id)
    .single()

  const response = NextResponse.redirect(`${origin}/dashboard`)

  if (org) {
    response.cookies.set('vo_active_org', JSON.stringify({ id: org.id, name: org.name }), {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 30,
    })
  }

  console.log('[accept-invite:success] user_id=', user.id, 'org_id=', invite.org_id)

  return response
}

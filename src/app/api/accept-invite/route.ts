import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveRequestOrigin } from '@/lib/site-url'
import { acceptPendingInvite } from '@/lib/invites/accept'

export const runtime = 'nodejs'

/**
 * GET /api/accept-invite
 *
 * Handles invite acceptance for users who already have an active Supabase
 * session — clicking "Accept Invitation" in the email when already logged in
 * never fires the OAuth callback, so the invite would otherwise never be
 * consumed.
 *
 *   - Not authenticated → /login (the OAuth callback accepts the invite there)
 *   - Authenticated → consume the pending invite (service-role; RLS can't),
 *     set active org + cookie, redirect to /dashboard
 */
export async function GET(request: Request) {
  const origin = resolveRequestOrigin(request)
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${origin}/login`)
  }

  const result = await acceptPendingInvite(user.id, user.email ?? '')

  const response = NextResponse.redirect(`${origin}/dashboard`)

  if (result.status === 'accepted') {
    response.cookies.set(
      'vo_active_org',
      JSON.stringify({ id: result.orgId, name: result.orgName }),
      { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 60 * 60 * 24 * 30 },
    )
  }

  return response
}

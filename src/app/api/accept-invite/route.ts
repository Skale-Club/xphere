import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveRequestOrigin } from '@/lib/site-url'
import {
  acceptInviteByToken,
  acceptPendingInvite,
  PENDING_INVITE_COOKIE,
  type AcceptInviteResult,
} from '@/lib/invites/accept'

export const runtime = 'nodejs'

/**
 * GET /api/accept-invite?token=<token>
 *
 * Entry point for the "Accept Invitation" email link.
 *   - Not authenticated → stash the token in a cookie, send to /login. The
 *     OAuth callback consumes it after Google sign-in.
 *   - Authenticated → accept the tokenized invite (service-role; RLS can't),
 *     set active org + cookie, redirect to /dashboard.
 *
 * A clear outcome (?invite=...) is appended so the dashboard can toast it.
 */
export async function GET(request: Request) {
  const origin = resolveRequestOrigin(request)
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Unauthenticated + tokenized link → carry the token through login.
  if (!user) {
    const res = NextResponse.redirect(`${origin}/login`)
    if (token) {
      res.cookies.set(PENDING_INVITE_COOKIE, token, {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        maxAge: 60 * 30, // 30 minutes to complete sign-in
      })
    }
    return res
  }

  const result: AcceptInviteResult = token
    ? await acceptInviteByToken(token, user.id, user.email ?? '')
    : await acceptPendingInvite(user.id, user.email ?? '')

  return redirectForResult(origin, result)
}

function redirectForResult(origin: string, result: AcceptInviteResult): NextResponse {
  if (result.status === 'accepted') {
    const res = NextResponse.redirect(`${origin}/dashboard?invite=joined`)
    res.cookies.set(
      'vo_active_org',
      JSON.stringify({ id: result.orgId, name: result.orgName }),
      { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 60 * 60 * 24 * 30 },
    )
    return res
  }

  if (result.status === 'mismatch') {
    return NextResponse.redirect(
      `${origin}/dashboard?invite=mismatch&for=${encodeURIComponent(result.invitedEmail)}`,
    )
  }

  const code = result.status === 'expired' ? 'expired' : 'invalid'
  return NextResponse.redirect(`${origin}/dashboard?invite=${code}`)
}

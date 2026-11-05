import { NextResponse } from 'next/server'

import { getSessionToken, getUser } from '@/lib/supabase/server'
import { getAppUserByEmail } from '@/lib/auth/users'
import {
  createSession,
  destroySession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth/session'
import { getDemoOrgId, getDemoUserEmail } from '@/lib/demo/config'

export const runtime = 'nodejs'

/**
 * Public entry point for the read-only demo.
 *
 * Opens an application session for the shared demo account (looked up server-
 * side by email: there is no password anywhere) and pins the active org to the
 * demo organization, then drops them into the dashboard. No sign-in prompt.
 * Read-only access is enforced by the app-layer guard (lib/demo/guard) and
 * restrictive RLS (migration 1114).
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const demoEmail = getDemoUserEmail()
  const demoOrgId = getDemoOrgId()

  if (!demoEmail || !demoOrgId) {
    console.error('[demo:misconfigured] missing DEMO_ORG_ID / DEMO_USER_EMAIL env')
    return NextResponse.redirect(`${origin}/`)
  }

  const [user, currentToken] = await Promise.all([getUser(), getSessionToken()])
  const alreadyDemo = user?.email?.toLowerCase().trim() === demoEmail

  let newSession: { token: string } | null = null
  if (!alreadyDemo) {
    const demoUser = await getAppUserByEmail(demoEmail)
    if (!demoUser) {
      console.error('[demo:signin-failed] no user row for DEMO_USER_EMAIL')
      return NextResponse.redirect(`${origin}/`)
    }

    // Clear any other identity first so we never mix a real session with demo.
    if (user && currentToken) {
      await destroySession(currentToken).catch((error) => {
        console.warn('[demo:destroy-session-failed]', error instanceof Error ? error.message : error)
      })
    }

    try {
      newSession = await createSession(demoUser.id, {
        userAgent: request.headers.get('user-agent'),
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      })
    } catch (error) {
      console.error('[demo:signin-failed]', error instanceof Error ? error.message : error)
      return NextResponse.redirect(`${origin}/`)
    }
  }

  // Pin the active org to the demo org (same cookie format post-login uses).
  const response = NextResponse.redirect(`${origin}/dashboard`)
  if (newSession) {
    response.cookies.set(SESSION_COOKIE, newSession.token, sessionCookieOptions())
  }
  response.cookies.set(
    'vo_active_org',
    JSON.stringify({ id: demoOrgId, name: 'Xphere Demo' }),
    {
      path: '/',
      sameSite: 'lax',
      httpOnly: false, // dashboard layout reads this client-side too
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  )
  return response
}

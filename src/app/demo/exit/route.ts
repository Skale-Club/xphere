import { NextResponse } from 'next/server'

import { getSessionToken } from '@/lib/supabase/server'
import { destroySession, SESSION_COOKIE } from '@/lib/auth/session'
import { resolveRequestOrigin } from '@/lib/site-url'

export const runtime = 'nodejs'

/**
 * Leaves the demo and opens the sign-in dialog on the landing page.
 *
 * Ends the shared demo session and clears the session and active-org cookies
 * first, so signing in never collides with the demo identity.
 */
export async function GET(request: Request) {
  const origin = resolveRequestOrigin(request)

  try {
    const token = await getSessionToken()
    if (token) await destroySession(token)
  } catch {
    // best-effort | the cookie is cleared below either way
  }

  const response = NextResponse.redirect(`${origin}/login`)
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  response.cookies.set('vo_active_org', '', { path: '/', maxAge: 0 })
  return response
}

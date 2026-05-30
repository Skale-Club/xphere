import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Leaves the demo and opens the signup flow on the landing page.
 *
 * Signs out the shared demo session and clears the active-org cookie first, so
 * the new account creation never collides with the demo identity.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const supabase = await createClient()

  try {
    await supabase.auth.signOut()
  } catch {
    // best-effort | continue to signup regardless
  }

  const response = NextResponse.redirect(`${origin}/?auth=signup`)
  response.cookies.set('vo_active_org', '', { path: '/', maxAge: 0 })
  return response
}

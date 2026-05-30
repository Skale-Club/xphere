import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getDemoCredentials, getDemoOrgId } from '@/lib/demo/config'

export const runtime = 'nodejs'

/**
 * Public entry point for the read-only demo.
 *
 * Signs the visitor into the shared demo account (credentials held server-side)
 * and pins the active org to the demo organization, then drops them into the
 * dashboard. No password prompt, no signup. Read-only access is enforced by the
 * app-layer guard (lib/demo/guard) and restrictive RLS (migration 1114).
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const creds = getDemoCredentials()
  const demoOrgId = getDemoOrgId()

  if (!creds || !demoOrgId) {
    console.error('[demo:misconfigured] missing DEMO_ORG_ID / DEMO_USER_* env')
    return NextResponse.redirect(`${origin}/`)
  }

  const supabase = await createClient()

  // Already signed in as the demo user? Skip straight to the dashboard.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const alreadyDemo =
    user?.email?.toLowerCase().trim() === creds.email.toLowerCase().trim()

  if (!alreadyDemo) {
    // Clear any other identity first so we never mix a real session with demo.
    if (user) await supabase.auth.signOut()

    const { error } = await supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    })

    if (error) {
      console.error('[demo:signin-failed]', error.message)
      return NextResponse.redirect(`${origin}/`)
    }
  }

  // Pin the active org to the demo org (same cookie format as auth/callback).
  const response = NextResponse.redirect(`${origin}/dashboard`)
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

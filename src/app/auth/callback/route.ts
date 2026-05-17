import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createClient()

  const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

  if (sessionError || !sessionData.user) {
    console.error('[auth/callback] exchangeCodeForSession error:', sessionError?.message)
    return NextResponse.redirect(`${origin}/login?error=auth_failed`)
  }

  const user = sessionData.user
  const rawEmail = user.email ?? ''
  // Normalize email: lowercase + trim to match idx_org_invites_email
  const normalizedEmail = rawEmail.toLowerCase().trim()

  if (!normalizedEmail) {
    return NextResponse.redirect(`${origin}/login?error=no_email`)
  }

  // Check if this email has a pending invite in ANY org
  const { data: invite, error: inviteError } = await supabase
    .from('org_invites')
    .select('id, org_id, role, accepted_at')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)
    .limit(1)
    .maybeSingle()

  if (inviteError) {
    console.error('[auth/callback] invite lookup error:', inviteError.message)
    return NextResponse.redirect(`${origin}/login?error=invite_lookup_failed`)
  }

  if (!invite) {
    // No pending invite — block access
    // Note: auth.users row was already created by Supabase OAuth. We cannot
    // prevent that. But we do NOT create an org_members row, so the user
    // has no access to any org's data.
    return NextResponse.redirect(`${origin}/login?error=not_invited`)
  }

  // Accept the invite: create org_members row
  const { error: memberError } = await supabase
    .from('org_members')
    .upsert(
      {
        user_id: user.id,
        organization_id: invite.org_id,
        role: invite.role,
      },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true }
    )

  if (memberError) {
    console.error('[auth/callback] org_members upsert error:', memberError.message)
    return NextResponse.redirect(`${origin}/login?error=membership_failed`)
  }

  // Mark invite as accepted
  await supabase
    .from('org_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  // Fetch org name for the cookie
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', invite.org_id)
    .single()

  // Build redirect response and set active org cookie
  const redirectUrl = next.startsWith('/') ? `${origin}${next}` : origin
  const response = NextResponse.redirect(redirectUrl)

  if (org) {
    response.cookies.set('vo_active_org', JSON.stringify({ id: org.id, name: org.name }), {
      path: '/',
      sameSite: 'lax',
      httpOnly: false, // dashboard layout reads this client-side too
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })
  }

  return response
}

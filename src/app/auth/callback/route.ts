import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveRequestOrigin } from '@/lib/site-url'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Behind Coolify/Traefik the standalone server binds to 0.0.0.0:3000, so the
  // request origin can be the internal container address. Resolve the canonical
  // public origin instead, or the post-login redirect lands on 0.0.0.0:3000.
  const origin = resolveRequestOrigin(request)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  console.log('[auth/callback:start] origin=', origin, 'has_code=', Boolean(code), 'next=', next)

  if (!code) {
    console.warn('[auth/callback:missing-code]')
    return NextResponse.redirect(`${origin}/`)
  }

  const supabase = await createClient()

  const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

  if (sessionError || !sessionData.user) {
    console.error('[auth/callback:exchange-failed]', sessionError?.message)
    return NextResponse.redirect(`${origin}/`)
  }

  const user = sessionData.user
  console.log('[auth/callback:code-exchanged] user_id=', user.id, 'email=', user.email)

  const rawEmail = user.email ?? ''
  // Normalize email: lowercase + trim to match idx_org_invites_email
  const normalizedEmail = rawEmail.toLowerCase().trim()

  if (!normalizedEmail) {
    console.warn('[auth/callback:no-email] user_id=', user.id)
    return NextResponse.redirect(`${origin}/`)
  }

  // 1) Existing-member fast path: if this auth user already belongs to an org,
  //    accept the OAuth login without requiring an invite. Existing admins
  //    (created before the invite system) and members previously added directly
  //    in the DB must be able to sign in with Google.
  const { data: existingMembership, error: membershipError } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (membershipError) {
    console.error('[auth/callback:membership-lookup-failed]', membershipError.message)
  }

  let resolvedOrgId: string | null = existingMembership?.organization_id ?? null

  if (resolvedOrgId) {
    console.log('[auth/callback:existing-member-found] org_id=', resolvedOrgId)
    // Respect the user's previously-saved org preference so that logging in
    // again doesn't silently switch to a different org than the one they last
    // used — which would cause a cookie/DB desync (UI shows org A, RLS
    // resolves org B → empty data pages).
    const { data: savedOrg } = await supabase
      .from('user_active_org')
      .select('organization_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (savedOrg?.organization_id) {
      resolvedOrgId = savedOrg.organization_id
      console.log('[auth/callback:using-saved-org] org_id=', resolvedOrgId)
    }
  }

  // 2) Invite path: only run if the user has no existing membership.
  if (!resolvedOrgId) {
    console.log('[auth/callback:invite-lookup] email=', normalizedEmail)
    const { data: invite, error: inviteError } = await supabase
      .from('org_invites')
      .select('id, org_id, role, accepted_at')
      .eq('email', normalizedEmail)
      .is('accepted_at', null)
      .limit(1)
      .maybeSingle()

    if (inviteError) {
      console.error('[auth/callback:invite-lookup-failed]', inviteError.message)
      return NextResponse.redirect(`${origin}/`)
    }

    if (!invite) {
      console.warn('[auth/callback:no-invite] email=', normalizedEmail)
      // No existing membership AND no pending invite | block access.
      // The auth.users row was created by Supabase OAuth (unavoidable) but
      // without an org_members row the user has no access to any org data.
      return NextResponse.redirect(`${origin}/`)
    }

    console.log('[auth/callback:invite-found] invite_id=', invite.id, 'org_id=', invite.org_id)

    // Accept the invite: create org_members row
    const { error: memberError } = await supabase
      .from('org_members')
      .upsert(
        {
          user_id: user.id,
          organization_id: invite.org_id,
          role: invite.role,
        },
        { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
      )

    if (memberError) {
      console.error('[auth/callback:member-upsert-failed]', memberError.message)
      return NextResponse.redirect(`${origin}/`)
    }

    // Mark invite as accepted
    await supabase
      .from('org_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id)

    resolvedOrgId = invite.org_id
  }

  // Fetch org name for the cookie
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', resolvedOrgId)
    .single()

  // Build redirect response and set active org cookie
  const redirectUrl = next.startsWith('/') ? `${origin}${next}` : origin
  console.log('[auth/callback:redirect-to]', redirectUrl, 'org_id=', resolvedOrgId)
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

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveRequestOrigin } from '@/lib/site-url'
import { acceptPendingInvite } from '@/lib/invites/accept'

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

  let user = sessionData?.user ?? null

  if (sessionError || !user) {
    // The code may have already been exchanged — e.g. a duplicate request, a
    // retry, or another entry-point consuming the same PKCE code. A code can
    // only be exchanged once, so a second attempt errors with "code already
    // used". If a valid session already exists, continue with it instead of
    // bouncing the user back to "/" and forcing another login.
    const { data: { user: existing } } = await supabase.auth.getUser()
    if (!existing) {
      console.error('[auth/callback:exchange-failed]', sessionError?.message)
      return NextResponse.redirect(`${origin}/`)
    }
    user = existing
    console.log('[auth/callback:reused-existing-session] user_id=', user.id)
  }

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
  let resolvedOrgName: string | null = null

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
  //    Consumed via the service role — a member-less user is blocked by RLS
  //    from reading the invite or inserting its own membership (see
  //    src/lib/invites/accept.ts for the full rationale).
  if (!resolvedOrgId) {
    console.log('[auth/callback:invite-lookup] email=', normalizedEmail)
    const result = await acceptPendingInvite(user.id, normalizedEmail)

    if (result.status === 'error') {
      console.error('[auth/callback:invite-accept-failed]', result.message)
      return NextResponse.redirect(`${origin}/`)
    }

    if (result.status === 'no-invite') {
      console.warn('[auth/callback:no-invite] email=', normalizedEmail)
      // No existing membership AND no pending invite | block access.
      // The auth.users row was created by Supabase OAuth (unavoidable) but
      // without an org_members row the user has no access to any org data.
      return NextResponse.redirect(`${origin}/`)
    }

    console.log('[auth/callback:invite-accepted] org_id=', result.orgId)
    resolvedOrgId = result.orgId
    resolvedOrgName = result.orgName
  }

  // Fetch org name for the cookie (already known when the invite path ran).
  let org: { id: string; name: string } | null = resolvedOrgName
    ? { id: resolvedOrgId, name: resolvedOrgName }
    : null
  if (!org) {
    const { data } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('id', resolvedOrgId)
      .single()
    org = data
  }

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

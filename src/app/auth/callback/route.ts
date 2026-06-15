import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { resolveRequestOrigin } from '@/lib/site-url'
import {
  acceptInviteByToken,
  acceptPendingInvite,
  PENDING_INVITE_COOKIE,
} from '@/lib/invites/accept'

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

  let resolvedOrgId: string | null = null
  let resolvedOrgName: string | null = null
  // Outcome appended to the dashboard redirect so the UI can toast it.
  let inviteOutcome: string | null = null

  // 0) Tokenized invite (highest priority): an unauthenticated click on the
  //    "Accept Invitation" link stashed its token here before bouncing through
  //    login. Honoring it FIRST means a user who already belongs to org A but
  //    clicked an invite to org B joins B (and lands there), instead of being
  //    silently routed to A by the existing-member path below.
  const cookieStore = await cookies()
  const pendingToken = cookieStore.get(PENDING_INVITE_COOKIE)?.value ?? null
  let clearPendingCookie = false

  if (pendingToken) {
    clearPendingCookie = true
    const result = await acceptInviteByToken(pendingToken, user.id, normalizedEmail)
    if (result.status === 'accepted') {
      console.log('[auth/callback:token-invite-accepted] org_id=', result.orgId)
      resolvedOrgId = result.orgId
      resolvedOrgName = result.orgName
      inviteOutcome = 'joined'
    } else if (result.status === 'mismatch') {
      console.warn('[auth/callback:token-invite-mismatch] for=', result.invitedEmail)
      inviteOutcome = 'mismatch'
    } else if (result.status === 'expired') {
      inviteOutcome = 'expired'
    } else {
      console.warn('[auth/callback:token-invite-unresolved]', result.status)
    }
    // On any non-accepted outcome we fall through to normal resolution so the
    // user still lands in an org they already belong to, if any.
  }

  // 1) Existing-member fast path: if this auth user already belongs to an org,
  //    accept the OAuth login without requiring an invite. Existing admins
  //    (created before the invite system) and members previously added directly
  //    in the DB must be able to sign in with Google. Skipped when a tokenized
  //    invite already resolved the org above.
  if (!resolvedOrgId) {
    const { data: existingMembership, error: membershipError } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (membershipError) {
      console.error('[auth/callback:membership-lookup-failed]', membershipError.message)
    }

    resolvedOrgId = existingMembership?.organization_id ?? null

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
  }

  // 2) Email-based invite fallback: only if nothing resolved yet. Consumed via
  //    the service role — a member-less user is blocked by RLS from reading the
  //    invite or inserting its own membership (see src/lib/invites/accept.ts).
  if (!resolvedOrgId) {
    console.log('[auth/callback:invite-lookup] email=', normalizedEmail)
    const result = await acceptPendingInvite(user.id, normalizedEmail)

    if (result.status === 'accepted') {
      console.log('[auth/callback:invite-accepted] org_id=', result.orgId)
      resolvedOrgId = result.orgId
      resolvedOrgName = result.orgName
    } else if (result.status === 'error') {
      console.error('[auth/callback:invite-accept-failed]', result.message)
    } else {
      console.warn('[auth/callback:invite-unresolved]', result.status)
    }
  }

  // No org could be resolved by any path: the auth.users row exists (Supabase
  // OAuth creates it unavoidably) but without an org_members row the user has
  // no access. Bounce to landing, preserving any invite outcome for context.
  if (!resolvedOrgId) {
    const res = NextResponse.redirect(
      `${origin}/${inviteOutcome ? `?invite=${inviteOutcome}` : ''}`,
    )
    if (clearPendingCookie) res.cookies.set(PENDING_INVITE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
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
  const base = next.startsWith('/') ? `${origin}${next}` : `${origin}/dashboard`
  const redirectUrl = new URL(base)
  if (inviteOutcome) redirectUrl.searchParams.set('invite', inviteOutcome)
  console.log('[auth/callback:redirect-to]', redirectUrl.toString(), 'org_id=', resolvedOrgId)
  const response = NextResponse.redirect(redirectUrl.toString())

  if (org) {
    response.cookies.set('vo_active_org', JSON.stringify({ id: org.id, name: org.name }), {
      path: '/',
      sameSite: 'lax',
      httpOnly: false, // dashboard layout reads this client-side too
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })
  }

  if (clearPendingCookie) {
    response.cookies.set(PENDING_INVITE_COOKIE, '', { path: '/', maxAge: 0 })
  }

  return response
}

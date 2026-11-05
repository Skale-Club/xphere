import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/request-ip'
import { isSameAuthOrigin } from '@/lib/auth/same-origin'
import { googleAuthConfig, verifyGoogleIdentity, type GoogleIdentity } from '@/lib/auth/google-identity'
import { bindGoogleIdentities, userIdForGoogleIdentity, type IdentityBinding } from '@/lib/auth/identities'
import {
  createAppUser,
  getAppUserByEmail,
  getAppUserById,
  getAppUserByPhone,
  markSignedIn,
  setUserPhone,
  type AppUser,
} from '@/lib/auth/users'
import {
  PENDING_LINK_COOKIE,
  pendingLinkCookieOptions,
  readPendingLink,
  signPendingLink,
} from '@/lib/auth/pending-link'
import {
  ACTIVE_ORG_COOKIE,
  ACTIVE_ORG_COOKIE_OPTIONS,
  readPendingInvite,
  resolvePostLoginOrg,
} from '@/lib/auth/post-login'
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session'
import { PENDING_INVITE_COOKIE } from '@/lib/invites/accept'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/** Drop anything that looks like a phone number before an error reaches the logs. */
function safeMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : 'unknown error'
  return text.replace(/\+?\d[\d\s().-]{6,}\d/g, '[redacted]').slice(0, 200)
}

async function findAccount(binding: IdentityBinding, phone?: string): Promise<AppUser | null> {
  const linkedId = await userIdForGoogleIdentity(binding)
  if (linkedId) {
    const user = await getAppUserById(linkedId)
    if (user) return user
  }
  return phone ? getAppUserByPhone(phone) : null
}

/**
 * An unknown, verified phone may create or claim an account only with a valid
 * invite: the emailed token proves ownership of the invited address. An existing
 * account on that email without a phone adopts the number; one that already has
 * a different phone is never taken over.
 */
async function provisionFromInvite(phone: string): Promise<AppUser | null> {
  const invite = await readPendingInvite()
  if (!invite) return null
  const existing = await getAppUserByEmail(invite.email)
  if (existing) {
    if (existing.phone) return null
    await setUserPhone(existing.id, phone)
    return { ...existing, phone }
  }
  return createAppUser({ email: invite.email, phone })
}

export async function POST(request: Request) {
  try {
    if (!isSameAuthOrigin(request)) return reply({ code: 'origin_denied' }, 403)

    const limit = await rateLimit(`google-login:${getClientIp(request)}`, 30, 15 * 60, { failMode: 'memory' })
    if (!limit.allowed) return reply({ code: 'rate_limited' }, 429)

    const config = googleAuthConfig()
    if (!config.enabled || !config.projectId) return reply({ code: 'auth_unavailable' }, 503)

    const body = (await request.json().catch(() => null)) as { idToken?: unknown } | null
    const token = body?.idToken
    if (typeof token !== 'string' || token.length > 16_384) return reply({ code: 'invalid_token' }, 400)

    let identity: GoogleIdentity
    try {
      identity = await verifyGoogleIdentity(token)
    } catch {
      return reply({ code: 'invalid_token' }, 401)
    }

    const binding: IdentityBinding = { projectId: config.projectId, uid: identity.uid }
    const cookieStore = await cookies()
    let user = await findAccount(binding, identity.phone)

    // A Google identity waiting for its texted code is linked together with the
    // phone identity that proves it.
    const bindings = [binding]
    if (identity.provider === 'phone') {
      const pending = await readPendingLink(cookieStore.get(PENDING_LINK_COOKIE)?.value)
      if (pending) bindings.push(pending)
    }

    if (!user && !identity.phone) {
      // Never claim an existing account merely by matching its email.
      const res = reply({ status: 'phone_required' })
      res.cookies.set(PENDING_LINK_COOKIE, await signPendingLink(binding), pendingLinkCookieOptions())
      return res
    }

    if (!user) {
      user = await provisionFromInvite(identity.phone!)
      if (!user) return reply({ status: 'no_access' })
    }

    await bindGoogleIdentities(bindings, user.id)

    const org = await resolvePostLoginOrg(user.id, user.email)
    if (!org.orgId) {
      const res = reply({ status: 'no_org', invite: org.inviteOutcome })
      res.cookies.set(PENDING_LINK_COOKIE, '', { path: '/', maxAge: 0 })
      if (org.clearPendingCookie) res.cookies.set(PENDING_INVITE_COOKIE, '', { path: '/', maxAge: 0 })
      return res
    }

    const session = await createSession(user.id, {
      userAgent: request.headers.get('user-agent'),
      ip: getClientIp(request),
    })
    await markSignedIn(user.id)

    const res = reply({ status: 'active', invite: org.inviteOutcome })
    res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions())
    res.cookies.set(ACTIVE_ORG_COOKIE, JSON.stringify({ id: org.orgId, name: org.orgName }), ACTIVE_ORG_COOKIE_OPTIONS)
    res.cookies.set(PENDING_LINK_COOKIE, '', { path: '/', maxAge: 0 })
    if (org.clearPendingCookie) res.cookies.set(PENDING_INVITE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  } catch (err) {
    // Never log the token or the phone: only a scrubbed message.
    console.error('[auth/identity] account or session provisioning failed:', safeMessage(err))
    return reply({ code: 'auth_unavailable' }, 500)
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  rateLimit: vi.fn(),
  config: vi.fn(),
  verify: vi.fn(),
  userIdForGoogleIdentity: vi.fn(),
  bind: vi.fn(),
  getAppUserById: vi.fn(),
  getAppUserByPhone: vi.fn(),
  getAppUserByEmail: vi.fn(),
  createAppUser: vi.fn(),
  setUserPhone: vi.fn(),
  markSignedIn: vi.fn(),
  readPendingLink: vi.fn(),
  signPendingLink: vi.fn(),
  readPendingInvite: vi.fn(),
  resolvePostLoginOrg: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.rateLimit }))
vi.mock('@/lib/request-ip', () => ({ getClientIp: () => '9.9.9.9' }))
vi.mock('@/lib/auth/same-origin', () => ({ isSameAuthOrigin: m.sameOrigin }))
vi.mock('@/lib/auth/google-identity', () => ({ googleAuthConfig: m.config, verifyGoogleIdentity: m.verify }))
vi.mock('@/lib/auth/identities', () => ({
  userIdForGoogleIdentity: m.userIdForGoogleIdentity,
  bindGoogleIdentities: m.bind,
}))
vi.mock('@/lib/auth/users', () => ({
  getAppUserById: m.getAppUserById,
  getAppUserByPhone: m.getAppUserByPhone,
  getAppUserByEmail: m.getAppUserByEmail,
  createAppUser: m.createAppUser,
  setUserPhone: m.setUserPhone,
  markSignedIn: m.markSignedIn,
}))
vi.mock('@/lib/auth/pending-link', () => ({
  PENDING_LINK_COOKIE: 'xphere_pending_google',
  pendingLinkCookieOptions: () => ({ httpOnly: true, path: '/', maxAge: 600 }),
  readPendingLink: m.readPendingLink,
  signPendingLink: m.signPendingLink,
}))
vi.mock('@/lib/auth/post-login', () => ({
  ACTIVE_ORG_COOKIE: 'vo_active_org',
  ACTIVE_ORG_COOKIE_OPTIONS: { path: '/', maxAge: 100 },
  readPendingInvite: m.readPendingInvite,
  resolvePostLoginOrg: m.resolvePostLoginOrg,
}))
vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'xphere_session',
  sessionCookieOptions: () => ({ httpOnly: true, path: '/', maxAge: 100 }),
  createSession: m.createSession,
}))
vi.mock('@/lib/invites/accept', () => ({ PENDING_INVITE_COOKIE: 'pending_invite_token' }))

import { POST } from '@/app/api/auth/identity/route'

const PHONE = '+15085550100'
const user = { id: 'u1', email: 'a@b.co', phone: PHONE, user_metadata: {}, created_at: 'x' }

function call(body: unknown = { idToken: 't' }) {
  return POST(
    new Request('https://xphere.app/api/auth/identity', {
      method: 'POST',
      headers: { origin: 'https://xphere.app', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.sameOrigin.mockReturnValue(true)
  m.rateLimit.mockResolvedValue({ allowed: true })
  m.config.mockReturnValue({ enabled: true, projectId: 'proj' })
  m.verify.mockResolvedValue({ uid: 'g1', provider: 'google.com', email: 'a@b.co' })
  m.userIdForGoogleIdentity.mockResolvedValue(null)
  m.getAppUserById.mockResolvedValue(null)
  m.getAppUserByPhone.mockResolvedValue(null)
  m.getAppUserByEmail.mockResolvedValue(null)
  m.readPendingLink.mockResolvedValue(null)
  m.signPendingLink.mockResolvedValue('signed-pending')
  m.readPendingInvite.mockResolvedValue(null)
  m.createAppUser.mockResolvedValue(user)
  m.resolvePostLoginOrg.mockResolvedValue({ orgId: 'o1', orgName: 'Org', inviteOutcome: null, clearPendingCookie: false })
  m.createSession.mockResolvedValue({ token: 'sess-token', expiresAt: new Date() })
})

describe('POST /api/auth/identity', () => {
  it('403 origin_denied before anything else', async () => {
    m.sameOrigin.mockReturnValue(false)
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 'origin_denied' })
    expect(m.rateLimit).not.toHaveBeenCalled()
  })

  it('429 rate_limited', async () => {
    m.rateLimit.mockResolvedValue({ allowed: false })
    const res = await call()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ code: 'rate_limited' })
    expect(m.rateLimit).toHaveBeenCalledWith('google-login:9.9.9.9', 30, 900, expect.anything())
  })

  it('503 auth_unavailable when sign-in is disabled', async () => {
    m.config.mockReturnValue({ enabled: false })
    expect((await call()).status).toBe(503)
  })

  it('400 invalid_token for a non-string or oversized token', async () => {
    expect((await call({ idToken: 5 })).status).toBe(400)
    expect((await call({ idToken: 'x'.repeat(16_385) })).status).toBe(400)
    expect(m.verify).not.toHaveBeenCalled()
  })

  it('401 invalid_token when verification fails', async () => {
    m.verify.mockRejectedValue(new Error('bad'))
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ code: 'invalid_token' })
  })

  it('phone_required for an unknown Google identity, parking it in the pending cookie', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ status: 'phone_required' })
    expect(res.cookies.get('xphere_pending_google')?.value).toBe('signed-pending')
    expect(m.createSession).not.toHaveBeenCalled()
    expect(m.createAppUser).not.toHaveBeenCalled()
  })

  it('no_access for an unknown phone without an invite, creating nothing', async () => {
    m.verify.mockResolvedValue({ uid: 'p1', provider: 'phone', phone: PHONE })
    const res = await call()
    expect(await res.json()).toEqual({ status: 'no_access' })
    expect(m.createAppUser).not.toHaveBeenCalled()
    expect(m.setUserPhone).not.toHaveBeenCalled()
    expect(res.cookies.get('xphere_session')).toBeUndefined()
  })

  it('creates the account from the invited email when the phone is unknown', async () => {
    m.verify.mockResolvedValue({ uid: 'p1', provider: 'phone', phone: PHONE })
    m.readPendingInvite.mockResolvedValue({ email: 'a@b.co' })
    const res = await call()
    expect(m.createAppUser).toHaveBeenCalledWith({ email: 'a@b.co', phone: PHONE })
    expect((await res.json()).status).toBe('active')
  })

  it('claims an existing phoneless account on the invited email', async () => {
    m.verify.mockResolvedValue({ uid: 'p1', provider: 'phone', phone: PHONE })
    m.readPendingInvite.mockResolvedValue({ email: 'a@b.co' })
    m.getAppUserByEmail.mockResolvedValue({ ...user, phone: undefined })
    const res = await call()
    expect(m.setUserPhone).toHaveBeenCalledWith('u1', PHONE)
    expect(m.createAppUser).not.toHaveBeenCalled()
    expect(m.bind).toHaveBeenCalledWith([{ projectId: 'proj', uid: 'p1' }], 'u1')
    expect((await res.json()).status).toBe('active')
  })

  it('never takes over an account that already has a different phone', async () => {
    m.verify.mockResolvedValue({ uid: 'p1', provider: 'phone', phone: '+15085550199' })
    m.readPendingInvite.mockResolvedValue({ email: 'a@b.co' })
    m.getAppUserByEmail.mockResolvedValue(user)
    const res = await call()
    expect(await res.json()).toEqual({ status: 'no_access' })
    expect(m.setUserPhone).not.toHaveBeenCalled()
  })

  it('no_org signs nobody in and reports the invite outcome', async () => {
    m.verify.mockResolvedValue({ uid: 'p1', provider: 'phone', phone: PHONE })
    m.getAppUserByPhone.mockResolvedValue(user)
    m.resolvePostLoginOrg.mockResolvedValue({ orgId: null, inviteOutcome: 'expired', clearPendingCookie: true })
    const res = await call()
    expect(await res.json()).toEqual({ status: 'no_org', invite: 'expired' })
    expect(m.createSession).not.toHaveBeenCalled()
    expect(res.cookies.get('xphere_session')).toBeUndefined()
  })

  it('active: links the pending Google identity with the phone, sets the cookies', async () => {
    m.verify.mockResolvedValue({ uid: 'p1', provider: 'phone', phone: PHONE })
    m.getAppUserByPhone.mockResolvedValue(user)
    m.readPendingLink.mockResolvedValue({ projectId: 'proj', uid: 'g1' })
    m.resolvePostLoginOrg.mockResolvedValue({ orgId: 'o1', orgName: 'Org', inviteOutcome: 'joined', clearPendingCookie: true })
    const res = await call()
    expect(await res.json()).toEqual({ status: 'active', invite: 'joined' })
    expect(m.bind).toHaveBeenCalledWith(
      [{ projectId: 'proj', uid: 'p1' }, { projectId: 'proj', uid: 'g1' }],
      'u1',
    )
    expect(m.markSignedIn).toHaveBeenCalledWith('u1')
    expect(res.cookies.get('xphere_session')?.value).toBe('sess-token')
    expect(JSON.parse(res.cookies.get('vo_active_org')!.value)).toEqual({ id: 'o1', name: 'Org' })
    expect(res.cookies.get('xphere_pending_google')?.value).toBe('')
    expect(res.cookies.get('pending_invite_token')?.value).toBe('')
  })

  it('finds a returning Google user by the stored link', async () => {
    m.userIdForGoogleIdentity.mockResolvedValue('u1')
    m.getAppUserById.mockResolvedValue(user)
    const res = await call()
    expect((await res.json()).status).toBe('active')
    expect(m.createAppUser).not.toHaveBeenCalled()
  })

  it('500 auth_unavailable on an unexpected error, without leaking the phone to logs', async () => {
    m.verify.mockResolvedValue({ uid: 'p1', provider: 'phone', phone: PHONE })
    m.getAppUserByPhone.mockRejectedValue(new Error(`boom for ${PHONE}`))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ code: 'auth_unavailable' })
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)
    expect(logged).not.toContain('5085550100')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose'

// DB_JWT_SECRET mode of the bridge: the token is signed in-process, no Supabase call.
const m = vi.hoisted(() => ({ generateLink: vi.fn(), verifyOtp: vi.fn(), createUser: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { generateLink: m.generateLink, createUser: m.createUser }, verifyOtp: m.verifyOtp },
  })),
}))

const SECRET = 'test-secret-at-least-32-bytes-long-0123456789'
const user = {
  id: '6f1d1f6e-0000-4000-8000-000000000001',
  email: 'a@b.co',
  phone: '+15550001111',
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

let now = 1_800_000_000
let fetchMock: ReturnType<typeof vi.fn>

async function load() {
  return import('@/lib/auth/supabase-jwt')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pub')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
  vi.spyOn(Date, 'now').mockImplementation(() => now * 1000)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('mintSupabaseJwt with DB_JWT_SECRET', () => {
  it('signs an HS256 token that verifies with the secret and carries the claims SQL reads', async () => {
    vi.stubEnv('DB_JWT_SECRET', SECRET)
    const { mintSupabaseJwt } = await load()

    const { token, expiresAt } = await mintSupabaseJwt(user)

    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
      audience: 'authenticated',
      currentDate: new Date(now * 1000),
    })
    expect(protectedHeader.alg).toBe('HS256')
    expect(payload.sub).toBe(user.id)
    expect(payload.role).toBe('authenticated')
    expect(payload.aud).toBe('authenticated')
    expect(payload.iat).toBe(now)
    expect(payload.exp).toBe(now + 3600)
    expect(payload.email).toBe('a@b.co')
    expect(payload.phone).toBe('+15550001111')
    expect(expiresAt).toBe(now + 3600)
  })

  it('rejects the token under a different secret', async () => {
    vi.stubEnv('DB_JWT_SECRET', SECRET)
    const { mintSupabaseJwt } = await load()
    const { token } = await mintSupabaseJwt(user)

    await expect(jwtVerify(token, new TextEncoder().encode('another-secret-another-secret-123456'))).rejects.toThrow()
  })

  it('omits email and phone when the user has none', async () => {
    vi.stubEnv('DB_JWT_SECRET', SECRET)
    const { mintSupabaseJwt } = await load()
    const { token } = await mintSupabaseJwt({ ...user, email: undefined, phone: undefined })

    const claims = decodeJwt(token)
    expect(claims).not.toHaveProperty('email')
    expect(claims).not.toHaveProperty('phone')
    expect(decodeProtectedHeader(token).typ).toBe('JWT')
  })

  it('makes no network call and does not touch Supabase Auth, even without an email', async () => {
    vi.stubEnv('DB_JWT_SECRET', SECRET)
    const { mintSupabaseJwt } = await load()

    await mintSupabaseJwt({ ...user, email: undefined })

    expect(m.generateLink).not.toHaveBeenCalled()
    expect(m.verifyOtp).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reuses the token while more than five minutes remain, then signs a new one', async () => {
    vi.stubEnv('DB_JWT_SECRET', SECRET)
    const { mintSupabaseJwt } = await load()

    const first = await mintSupabaseJwt(user)
    now += 3600 - 6 * 60
    const reused = await mintSupabaseJwt(user)
    expect(reused.token).toBe(first.token)

    now += 2 * 60 // 4 minutes left: inside the refresh margin
    const renewed = await mintSupabaseJwt(user)
    expect(renewed.token).not.toBe(first.token)
    expect(renewed.expiresAt).toBe(now + 3600)
    expect(decodeJwt(renewed.token).exp).toBe(now + 3600)
  })

  it('keeps one cache entry per user', async () => {
    vi.stubEnv('DB_JWT_SECRET', SECRET)
    const { mintSupabaseJwt } = await load()

    const a = await mintSupabaseJwt(user)
    const b = await mintSupabaseJwt({ ...user, id: 'other-user' })

    expect(decodeJwt(a.token).sub).toBe(user.id)
    expect(decodeJwt(b.token).sub).toBe('other-user')
  })

  it('an empty DB_JWT_SECRET counts as unset and uses the bridge', async () => {
    vi.stubEnv('DB_JWT_SECRET', '')
    m.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'h' } }, error: null })
    m.verifyOtp.mockResolvedValue({ data: { session: { access_token: 'bridge-tok', expires_in: 3600 } }, error: null })
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const { mintSupabaseJwt } = await load()

    await expect(mintSupabaseJwt(user)).resolves.toMatchObject({ token: 'bridge-tok' })
  })
})

describe('mintSupabaseJwt without DB_JWT_SECRET', () => {
  it('calls the Supabase bridge', async () => {
    vi.stubEnv('DB_JWT_SECRET', '')
    m.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'h' } }, error: null })
    m.verifyOtp.mockResolvedValue({ data: { session: { access_token: 'bridge-tok', expires_in: 3600 } }, error: null })
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    delete process.env.DB_JWT_SECRET
    const { mintSupabaseJwt } = await load()

    const result = await mintSupabaseJwt(user)

    expect(result).toEqual({ token: 'bridge-tok', expiresAt: now + 3600 })
    expect(m.generateLink).toHaveBeenCalledTimes(1)
    expect(m.verifyOtp).toHaveBeenCalledTimes(1)
  })
})

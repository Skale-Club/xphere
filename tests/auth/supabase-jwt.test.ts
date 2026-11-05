import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The bridge talks to Supabase through two supabase-js clients. Both are faked so the
// suite touches no network and no database.
const m = vi.hoisted(() => ({
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  createUser: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { generateLink: m.generateLink, createUser: m.createUser }, verifyOtp: m.verifyOtp },
  })),
}))

const user = {
  id: '6f1d1f6e-0000-4000-8000-000000000001',
  email: 'a@b.co',
  phone: undefined,
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

let now = 1_800_000_000
let fetchMock: ReturnType<typeof vi.fn>

function okSession(token: string, expiresIn = 3600) {
  m.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'hash' }, user: { id: user.id } }, error: null })
  m.verifyOtp.mockResolvedValue({ data: { session: { access_token: token, expires_in: expiresIn } }, error: null })
}

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
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('mintSupabaseJwt', () => {
  it('obtains a token through generateLink + verifyOtp and logs the session out locally', async () => {
    okSession('tok-1')
    const { mintSupabaseJwt } = await load()

    const result = await mintSupabaseJwt(user)

    expect(result).toEqual({ token: 'tok-1', expiresAt: now + 3600 })
    expect(m.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'a@b.co' })
    expect(m.verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash', type: 'magiclink' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://proj.supabase.co/auth/v1/logout?scope=local')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
  })

  it('reuses a cached token while more than five minutes remain', async () => {
    okSession('tok-1')
    const { mintSupabaseJwt } = await load()

    await mintSupabaseJwt(user)
    now += 3600 - 6 * 60
    const again = await mintSupabaseJwt(user)

    expect(again.token).toBe('tok-1')
    expect(m.generateLink).toHaveBeenCalledTimes(1)
  })

  it('fetches a new token inside the five-minute margin', async () => {
    okSession('tok-1')
    const { mintSupabaseJwt } = await load()
    await mintSupabaseJwt(user)

    now += 3600 - 4 * 60
    okSession('tok-2')
    const again = await mintSupabaseJwt(user)

    expect(again.token).toBe('tok-2')
    expect(m.generateLink).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between concurrent requests', async () => {
    okSession('tok-1')
    const { mintSupabaseJwt } = await load()

    const [a, b, c] = await Promise.all([mintSupabaseJwt(user), mintSupabaseJwt(user), mintSupabaseJwt(user)])

    expect(a.token).toBe('tok-1')
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(m.generateLink).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure', async () => {
    m.generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { mintSupabaseJwt } = await load()
    await expect(mintSupabaseJwt(user)).rejects.toThrow('generateLink failed: boom')

    okSession('tok-ok')
    await expect(mintSupabaseJwt(user)).resolves.toMatchObject({ token: 'tok-ok' })
  })

  it('fails when verifyOtp returns no session, without echoing tokens', async () => {
    m.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'secret-hash' } }, error: null })
    m.verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } })
    const { mintSupabaseJwt } = await load()

    const error = await mintSupabaseJwt(user).catch((e: Error) => e)

    expect((error as Error).message).toContain('verifyOtp failed: expired')
    expect((error as Error).message).not.toContain('secret-hash')
  })

  it('errors clearly when the user has no email', async () => {
    const { mintSupabaseJwt } = await load()
    await expect(mintSupabaseJwt({ ...user, email: undefined })).rejects.toThrow('no email')
    expect(m.generateLink).not.toHaveBeenCalled()
  })
})

describe('createAuthShadow', () => {
  it('creates a confirmed user with no password and returns its id', async () => {
    m.createUser.mockResolvedValue({ data: { user: { id: 'new-id' } }, error: null })
    const { createAuthShadow } = await load()

    await expect(createAuthShadow({ email: ' A@B.co ' })).resolves.toBe('new-id')
    expect(m.createUser).toHaveBeenCalledWith({ email: 'a@b.co', email_confirm: true })
  })

  it('refuses an email already registered, so a new account never inherits an old one', async () => {
    m.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'exists' } })
    const { createAuthShadow } = await load()

    await expect(createAuthShadow({ email: 'a@b.co' })).rejects.toThrow('createAuthShadow failed')
  })
})

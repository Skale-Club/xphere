import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Drive isDemoSession() by mocking the cached auth helper.
const getUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUserMock(),
  createClient: vi.fn(),
}))

const DEMO_ORG = '0000de00-0000-4000-8000-000000000001'
const OTHER_ORG = '11111111-1111-4111-8111-111111111111'
const DEMO_EMAIL = 'demo@xphere.app'

describe('demo config (lib/demo/config)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('getDemoOrgId / getDemoUserEmail', () => {
    it('return empty strings when env is unset', async () => {
      vi.stubEnv('DEMO_ORG_ID', '')
      vi.stubEnv('DEMO_USER_EMAIL', '')
      const { getDemoOrgId, getDemoUserEmail } = await import('@/lib/demo/config')
      expect(getDemoOrgId()).toBe('')
      expect(getDemoUserEmail()).toBe('')
    })

    it('normalizes the demo email to lowercase + trimmed', async () => {
      vi.stubEnv('DEMO_USER_EMAIL', '  Demo@Xphere.App  ')
      const { getDemoUserEmail } = await import('@/lib/demo/config')
      expect(getDemoUserEmail()).toBe(DEMO_EMAIL)
    })
  })

  describe('isDemoOrg', () => {
    it('is false for any org when the demo org is unconfigured', async () => {
      vi.stubEnv('DEMO_ORG_ID', '')
      const { isDemoOrg } = await import('@/lib/demo/config')
      expect(isDemoOrg(OTHER_ORG)).toBe(false)
      expect(isDemoOrg('')).toBe(false)
    })

    it('matches only the configured demo org', async () => {
      vi.stubEnv('DEMO_ORG_ID', DEMO_ORG)
      const { isDemoOrg } = await import('@/lib/demo/config')
      expect(isDemoOrg(DEMO_ORG)).toBe(true)
      expect(isDemoOrg(OTHER_ORG)).toBe(false)
      expect(isDemoOrg(null)).toBe(false)
      expect(isDemoOrg(undefined)).toBe(false)
    })
  })

  describe('getDemoCredentials', () => {
    it('returns null when either credential is missing', async () => {
      const { getDemoCredentials } = await import('@/lib/demo/config')

      vi.stubEnv('DEMO_USER_EMAIL', '')
      vi.stubEnv('DEMO_USER_PASSWORD', 'secret')
      expect(getDemoCredentials()).toBeNull()

      vi.stubEnv('DEMO_USER_EMAIL', DEMO_EMAIL)
      vi.stubEnv('DEMO_USER_PASSWORD', '')
      expect(getDemoCredentials()).toBeNull()
    })

    it('returns the raw credentials when both are set', async () => {
      vi.stubEnv('DEMO_USER_EMAIL', DEMO_EMAIL)
      vi.stubEnv('DEMO_USER_PASSWORD', 'secret')
      const { getDemoCredentials } = await import('@/lib/demo/config')
      expect(getDemoCredentials()).toEqual({ email: DEMO_EMAIL, password: 'secret' })
    })
  })
})

describe('demo session guard (lib/demo/guard)', () => {
  beforeEach(() => {
    getUserMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('isDemoSession is false when DEMO_USER_EMAIL is unconfigured', async () => {
    vi.stubEnv('DEMO_USER_EMAIL', '')
    const { isDemoSession } = await import('@/lib/demo/guard')
    expect(await isDemoSession()).toBe(false)
    // never needs to look up the user when unconfigured
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('isDemoSession is false when there is no signed-in user', async () => {
    vi.stubEnv('DEMO_USER_EMAIL', DEMO_EMAIL)
    getUserMock.mockResolvedValueOnce(null)
    const { isDemoSession } = await import('@/lib/demo/guard')
    expect(await isDemoSession()).toBe(false)
  })

  it('isDemoSession matches the demo user case-insensitively and trimmed', async () => {
    vi.stubEnv('DEMO_USER_EMAIL', DEMO_EMAIL)
    const { isDemoSession } = await import('@/lib/demo/guard')

    getUserMock.mockResolvedValueOnce({ email: '  DEMO@Xphere.App ' })
    expect(await isDemoSession()).toBe(true)

    getUserMock.mockResolvedValueOnce({ email: 'real.user@acme.com' })
    expect(await isDemoSession()).toBe(false)
  })

  it('assertWritable allows writes when the demo is unconfigured', async () => {
    vi.stubEnv('DEMO_USER_EMAIL', '')
    const { assertWritable } = await import('@/lib/demo/guard')
    expect(await assertWritable()).toBeNull()
  })
})

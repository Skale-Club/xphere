import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the cached auth helpers so we can drive isDemoSession()/assertWritable().
const getUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  getUser: () => getUserMock(),
  createClient: vi.fn(),
}))

const DEMO_ORG = '0000de00-0000-4000-8000-000000000001'
const DEMO_EMAIL = 'demo@xphere.app'

describe('demo read-only enforcement', () => {
  beforeEach(() => {
    vi.stubEnv('DEMO_ORG_ID', DEMO_ORG)
    vi.stubEnv('DEMO_USER_EMAIL', DEMO_EMAIL)
    getUserMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('isDemoOrg matches only the configured demo org', async () => {
    const { isDemoOrg } = await import('@/lib/demo/config')
    expect(isDemoOrg(DEMO_ORG)).toBe(true)
    expect(isDemoOrg('11111111-1111-4111-8111-111111111111')).toBe(false)
    expect(isDemoOrg(null)).toBe(false)
  })

  it('assertWritable blocks the demo user and allows real users', async () => {
    const { assertWritable } = await import('@/lib/demo/guard')

    getUserMock.mockResolvedValueOnce({ email: DEMO_EMAIL })
    expect(await assertWritable()).toEqual({ error: expect.any(String) })

    getUserMock.mockResolvedValueOnce({ email: 'real.user@acme.com' })
    expect(await assertWritable()).toBeNull()
  })

  it('assertWritableOrThrow throws for the demo user', async () => {
    const { assertWritableOrThrow } = await import('@/lib/demo/guard')
    getUserMock.mockResolvedValueOnce({ email: DEMO_EMAIL })
    await expect(assertWritableOrThrow()).rejects.toThrow()
  })

  it('executeAction refuses any action for the demo org (no side effects)', async () => {
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    await expect(
      executeAction(
        'send_sms',
        { to: '+15555550123', message: 'hi' },
        {} as never,
        { organizationId: DEMO_ORG, supabase: {} as never },
      ),
    ).rejects.toThrow(/read-only/i)
  })
})

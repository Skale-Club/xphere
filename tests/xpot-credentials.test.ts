import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn(async (value: string) => `plain:${value}`) }))

const { getXpotCredentialsForOrg, XPOT_BASE_URL } = await import('@/lib/xpot/credentials')

const ORG = '55555555-5555-4555-8555-555555555555'

function fakeSupabase(row: Record<string, unknown> | null) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  }
  return { from: vi.fn(() => query) }
}

// The Xpot integration form only asks for the inbound key: there is one Xpot,
// so the connection must work without any URL saved on the integration row.
describe('Xpot credentials', () => {
  it('uses the fixed Xpot URL when the integration has no URL saved', async () => {
    const creds = await getXpotCredentialsForOrg(ORG, fakeSupabase({ encrypted_api_key: 'enc', location_id: null }) as never)
    expect(creds).toEqual({ baseUrl: 'https://xpot.place', apiKey: 'plain:enc' })
  })

  it('ignores a URL left on the row by the old form', async () => {
    const creds = await getXpotCredentialsForOrg(ORG, fakeSupabase({ encrypted_api_key: 'enc', location_id: 'https://old.example' }) as never)
    expect(creds?.baseUrl).toBe(XPOT_BASE_URL)
  })

  it('returns null when the org has no active Xpot integration', async () => {
    await expect(getXpotCredentialsForOrg(ORG, fakeSupabase(null) as never)).resolves.toBeNull()
  })
})

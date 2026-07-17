import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(async (s: string) => `dec:${s}`),
}))

interface CannedRow {
  encrypted_api_key: string | null
  location_id: string | null
  config: Record<string, string> | null
}

function buildSupabase(row: CannedRow | null) {
  const eq = vi.fn()
  const select = vi.fn()
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const from = vi.fn()

  // Chainable: from().select().eq().eq().eq().maybeSingle()
  const chain = {
    select: select.mockReturnThis(),
    eq: eq.mockReturnThis(),
    maybeSingle,
  }
  from.mockReturnValue(chain)

  return {
    supabase: { from } as unknown as import('@supabase/supabase-js').SupabaseClient<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >,
    from,
    eq,
    maybeSingle,
  }
}

describe('MED-02: getMedusaCredentialsForOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('decrypts the encrypted key and returns credentials with publishable key + storefront url', async () => {
    const { supabase, eq } = buildSupabase({
      encrypted_api_key: 'enc',
      location_id: 'http://localhost:9000',
      config: { publishable_key: 'pk_1', storefront_url: 'http://localhost:8000' },
    })
    const { getMedusaCredentialsForOrg } = await import('@/lib/medusa/credentials')
    const result = await getMedusaCredentialsForOrg('org-1', supabase)

    expect(result).toEqual({
      baseUrl: 'http://localhost:9000',
      connectionToken: 'dec:enc',
      publishableKey: 'pk_1',
      storefrontUrl: 'http://localhost:8000',
    })
    expect(eq).toHaveBeenCalledWith('provider', 'medusa')
    expect(eq).toHaveBeenCalledWith('is_active', true)
  })

  it('returns null when no integration row exists (decrypt not called)', async () => {
    const { supabase } = buildSupabase(null)
    const { decrypt } = await import('@/lib/crypto')
    const { getMedusaCredentialsForOrg } = await import('@/lib/medusa/credentials')
    const result = await getMedusaCredentialsForOrg('org-1', supabase)

    expect(result).toBeNull()
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('returns null when config.publishable_key is missing', async () => {
    const { supabase } = buildSupabase({
      encrypted_api_key: 'enc',
      location_id: 'http://localhost:9000',
      config: {},
    })
    const { getMedusaCredentialsForOrg } = await import('@/lib/medusa/credentials')
    const result = await getMedusaCredentialsForOrg('org-1', supabase)

    expect(result).toBeNull()
  })

  it('returns null when location_id is missing', async () => {
    const { supabase } = buildSupabase({
      encrypted_api_key: 'enc',
      location_id: null,
      config: { publishable_key: 'pk_1' },
    })
    const { getMedusaCredentialsForOrg } = await import('@/lib/medusa/credentials')
    const result = await getMedusaCredentialsForOrg('org-1', supabase)

    expect(result).toBeNull()
  })
})

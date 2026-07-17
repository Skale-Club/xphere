import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ---- Mocks -----------------------------------------------------------------
// medusaStoreFetch is mocked away entirely (so its own internal R11 rateLimit
// call never runs); the real error classes (MedusaRateLimitError etc.) are
// kept via importOriginal so `instanceof` checks in the executors still work.
const mockMedusaStoreFetch = vi.fn()
vi.mock('@/lib/medusa/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/medusa/client')>()
  return {
    ...actual,
    medusaStoreFetch: (...args: unknown[]) => mockMedusaStoreFetch(...args),
  }
})

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}))

// ---- Supabase chainable stub (conversations lookup) ------------------------
function makeSupabase(row: { session_key?: string | null; memory?: Record<string, unknown> } | null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
  return { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>
}

const CREDS = { baseUrl: 'http://localhost:9000', connectionToken: 'tok', publishableKey: 'pk_test' }

describe('searchMedusaProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 })
  })

  it('returns a concise listing with MAJOR-unit region-correct prices (happy path)', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { region_id: 'reg_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      products: [
        {
          title: 'Sweatshirt',
          handle: 'sweatshirt',
          variants: [{ calculated_price: { calculated_amount: 35, currency_code: 'eur' } }],
        },
      ],
    })
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')
    const result = await searchMedusaProducts({ query: 'sweatshirt' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })
    expect(result).toContain('Sweatshirt')
    expect(result).toContain('€35.00')
    expect(result).not.toContain('3,500.00')
    expect(result).not.toContain('3500.00')
    expect(result.split('\n').length).toBeLessThanOrEqual(5)
    const [, path] = mockMedusaStoreFetch.mock.calls[0] as [unknown, string]
    expect(path).toContain('region_id=reg_1')
  })

  it('resolves region via /store/regions when no region_id is pinned (country_code fallback)', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { country_code: 'dk' } } })
    mockMedusaStoreFetch
      .mockResolvedValueOnce({ regions: [{ id: 'reg_dk', countries: [{ iso_2: 'dk' }] }] })
      .mockResolvedValueOnce({ products: [] })
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')
    await searchMedusaProducts({}, CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' })
    expect(mockMedusaStoreFetch).toHaveBeenCalledTimes(2)
    const [, firstPath] = mockMedusaStoreFetch.mock.calls[0] as [unknown, string]
    expect(firstPath).toContain('/store/regions')
    const [, secondPath] = mockMedusaStoreFetch.mock.calls[1] as [unknown, string]
    expect(secondPath).toContain('/store/products')
    expect(secondPath).toContain('region_id=reg_dk')
  })

  it('returns a friendly "no products" string on empty results', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { region_id: 'reg_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({ products: [] })
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')
    const result = await searchMedusaProducts({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })
    expect(result.toLowerCase()).toContain('no products')
  })

  it('returns a friendly string and skips the store call when R6 is breached', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { region_id: 'reg_1' } } })
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')
    const result = await searchMedusaProducts({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })
    expect(result).toMatch(/limit|shortly|moment/i)
    expect(mockMedusaStoreFetch).not.toHaveBeenCalled()
  })

  it('returns a friendly "took too long" string on an 8s abort', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { region_id: 'reg_1' } } })
    mockMedusaStoreFetch.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')
    const result = await searchMedusaProducts({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })
    expect(result.toLowerCase()).toContain('too long')
  })
})

describe('getMedusaProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 })
  })

  it('answers by handle with a MAJOR-unit region-correct price', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { region_id: 'reg_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      products: [
        {
          title: 'Sweatshirt',
          handle: 'sweatshirt',
          variants: [{ calculated_price: { calculated_amount: 35, currency_code: 'eur' } }],
        },
      ],
    })
    const { getMedusaProduct } = await import('@/lib/medusa/actions/get-product')
    const result = await getMedusaProduct({ handle: 'sweatshirt' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })
    expect(result).toContain('Sweatshirt')
    expect(result).toContain('€35.00')
    const [, path] = mockMedusaStoreFetch.mock.calls[0] as [unknown, string]
    expect(path).toContain('handle=sweatshirt')
  })

  it('answers by product_id via /store/products/:id', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { region_id: 'reg_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      product: {
        title: 'Tote Bag',
        handle: 'tote-bag',
        variants: [{ calculated_price: { calculated_amount: 20, currency_code: 'eur' } }],
      },
    })
    const { getMedusaProduct } = await import('@/lib/medusa/actions/get-product')
    const result = await getMedusaProduct({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })
    expect(result).toContain('Tote Bag')
    const [, path] = mockMedusaStoreFetch.mock.calls[0] as [unknown, string]
    expect(path).toContain('/store/products/prod_1')
  })

  it('returns a friendly "not found" string when no product matches', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { region_id: 'reg_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({ products: [] })
    const { getMedusaProduct } = await import('@/lib/medusa/actions/get-product')
    const result = await getMedusaProduct({ handle: 'missing' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })
    expect(result.toLowerCase()).toContain("couldn't find")
  })
})

describe('getMedusaCart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 })
  })

  it('returns guidance when no cart is pinned, without calling the store', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: {} } })
    const { getMedusaCart } = await import('@/lib/medusa/actions/get-cart')
    const result = await getMedusaCart(CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' })
    expect(result.toLowerCase()).toContain('no cart')
    expect(mockMedusaStoreFetch).not.toHaveBeenCalled()
  })

  it('returns items + MAJOR-unit total for the pinned cart', async () => {
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      cart: {
        items: [{ title: 'Sweatshirt', quantity: 2, unit_price: 35 }],
        total: 70,
        currency_code: 'eur',
      },
    })
    const { getMedusaCart } = await import('@/lib/medusa/actions/get-cart')
    const result = await getMedusaCart(CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' })
    expect(result).toContain('Sweatshirt')
    expect(result).toContain('2')
    expect(result).toContain('€70.00')
  })

  it('anti-IDOR: the cart id can ONLY come from pinned memory (no params argument exists)', async () => {
    // getMedusaCart's signature is (creds, ctx) -- there is no params object,
    // so an attacker-controlled cart_id has no channel into the call at all.
    const supabase = makeSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      cart: { items: [], total: 0, currency_code: 'eur' },
    })
    const { getMedusaCart } = await import('@/lib/medusa/actions/get-cart')
    expect(getMedusaCart.length).toBe(2)
    await getMedusaCart(CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' })
    const [, path] = mockMedusaStoreFetch.mock.calls[0] as [unknown, string]
    expect(path).toContain('cart_1')
    expect(path).not.toContain('cart_EVIL')
  })
})

// tests/medusa-product-cards.test.ts
// UIX-01: resolveRegion (id + fallback country) in regions.ts, plus the
// ≤5-item `ui`/`product_cards` SSE emit in search-products.ts / get-product.ts
// (contract §6). Copies the medusaStoreFetch-mock-via-importOriginal +
// mockRateLimit idioms from tests/medusa-cart-write.test.ts; adds an
// emitStructured spy. See 137-RESEARCH.md and
// .planning/research/INTEGRATION-CONTRACT.md §6.

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
// Copied idiom from tests/medusa-cart-write.test.ts's buildSupabase.
function buildSupabase(row: { session_key?: string | null; memory: Record<string, unknown> | null } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const eq = vi.fn().mockReturnThis()
  const select = vi.fn().mockReturnThis()
  const chain = { select, eq, maybeSingle }
  const from = vi.fn().mockReturnValue(chain)
  return {
    supabase: { from } as unknown as SupabaseClient<Database>,
    from,
    eq,
    maybeSingle,
    select,
  }
}

const CREDS = { baseUrl: 'http://localhost:9000', connectionToken: 'tok', publishableKey: 'pk_test' }

// =============================================================================
// Task 1: resolveRegion (id + fallback country)
// =============================================================================

describe('resolveRegion — id + fallback country (UIX-01 Task 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matching country: returns that region id + the requested country', async () => {
    mockMedusaStoreFetch.mockResolvedValueOnce({
      regions: [
        { id: 'reg_dk', countries: [{ iso_2: 'dk' }] },
        { id: 'reg_us', countries: [{ iso_2: 'us' }] },
      ],
    })
    const { resolveRegion } = await import('@/lib/medusa/regions')

    const result = await resolveRegion(CREDS, 'org-1', 'us')

    expect(result).toEqual({ id: 'reg_us', countryCode: 'us' })
  })

  it('no countryCode: falls back to the first region + its first country', async () => {
    mockMedusaStoreFetch.mockResolvedValueOnce({
      regions: [
        { id: 'reg_dk', countries: [{ iso_2: 'dk' }] },
        { id: 'reg_us', countries: [{ iso_2: 'us' }] },
      ],
    })
    const { resolveRegion } = await import('@/lib/medusa/regions')

    const result = await resolveRegion(CREDS, 'org-1', undefined)

    expect(result).toEqual({ id: 'reg_dk', countryCode: 'dk' })
  })

  it('first/only region has NO countries: id is set, countryCode is undefined', async () => {
    mockMedusaStoreFetch.mockResolvedValueOnce({ regions: [{ id: 'reg_x' }] })
    const { resolveRegion } = await import('@/lib/medusa/regions')

    const result = await resolveRegion(CREDS, 'org-1', undefined)

    expect(result).toEqual({ id: 'reg_x', countryCode: undefined })
  })

  it('resolveRegionId still delegates to just the id string (regression)', async () => {
    mockMedusaStoreFetch.mockResolvedValueOnce({
      regions: [
        { id: 'reg_dk', countries: [{ iso_2: 'dk' }] },
        { id: 'reg_us', countries: [{ iso_2: 'us' }] },
      ],
    })
    const { resolveRegionId } = await import('@/lib/medusa/regions')

    const result = await resolveRegionId(CREDS, 'org', 'us')

    expect(result).toBe('reg_us')
  })
})

// =============================================================================
// Task 2: product_cards emit — search-products.ts + get-product.ts
// =============================================================================

function productFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod_1',
    title: 'Sweatshirt',
    handle: 'sweatshirt',
    thumbnail: 'https://img/1.png',
    variants: [{ id: 'variant_1', calculated_price: { calculated_amount: 35, currency_code: 'eur' } }],
    ...overrides,
  }
}

describe('product_cards emit — searchMedusaProducts (UIX-01 Task 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 })
  })

  it('emits <=5 items even when more than 5 products are returned', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { region_id: 'reg_dk', country_code: 'dk' } },
    })
    const products = Array.from({ length: 7 }, (_, i) => productFixture({ id: `prod_${i}`, handle: `handle-${i}` }))
    mockMedusaStoreFetch.mockResolvedValueOnce({ products })
    const emit = vi.fn()
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')

    await searchMedusaProducts({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
      emitStructured: emit,
    })

    expect(emit).toHaveBeenCalledTimes(1)
    const [emitted] = emit.mock.calls[0] as [{ event: string; component: string; items: unknown[] }]
    expect(emitted.event).toBe('ui')
    expect(emitted.component).toBe('product_cards')
    expect(emitted.items.length).toBe(5)
  })

  it('item shape: id/variantId/title/thumbnail/price/handle/url (relative when storefrontUrl absent)', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { region_id: 'reg_dk', country_code: 'dk' } },
    })
    mockMedusaStoreFetch.mockResolvedValueOnce({ products: [productFixture()] })
    const emit = vi.fn()
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')
    const { formatMoney } = await import('@/lib/medusa/format')

    await searchMedusaProducts({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
      emitStructured: emit,
    })

    const [emitted] = emit.mock.calls[0] as [{ items: Record<string, unknown>[] }]
    expect(emitted.items[0]).toEqual({
      id: 'prod_1',
      variantId: 'variant_1',
      title: 'Sweatshirt',
      thumbnail: 'https://img/1.png',
      price: formatMoney(35, 'eur'),
      handle: 'sweatshirt',
      url: '/dk/products/sweatshirt',
    })
  })

  it('url includes storefrontUrl when creds carry one', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { region_id: 'reg_dk', country_code: 'dk' } },
    })
    mockMedusaStoreFetch.mockResolvedValueOnce({ products: [productFixture()] })
    const emit = vi.fn()
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')

    await searchMedusaProducts(
      {},
      { ...CREDS, storefrontUrl: 'http://localhost:8000' },
      { organizationId: 'org-1', supabase, conversationId: 'conv-1', emitStructured: emit },
    )

    const [emitted] = emit.mock.calls[0] as [{ items: Record<string, unknown>[] }]
    expect(emitted.items[0].url).toBe('http://localhost:8000/dk/products/sweatshirt')
  })

  it('url country fallback via resolved region when nothing is pinned', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: {} } })
    mockMedusaStoreFetch
      .mockResolvedValueOnce({ regions: [{ id: 'reg_dk', countries: [{ iso_2: 'dk' }] }] })
      .mockResolvedValueOnce({ products: [productFixture()] })
    const emit = vi.fn()
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')

    await searchMedusaProducts({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
      emitStructured: emit,
    })

    const [emitted] = emit.mock.calls[0] as [{ items: Record<string, unknown>[] }]
    expect(emitted.items[0].url).toBe('/dk/products/sweatshirt')
  })

  it('url OMITTED when no country can be determined', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: {} } })
    mockMedusaStoreFetch
      .mockResolvedValueOnce({ regions: [{ id: 'reg_x' }] })
      .mockResolvedValueOnce({ products: [productFixture()] })
    const emit = vi.fn()
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')

    await searchMedusaProducts({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
      emitStructured: emit,
    })

    const [emitted] = emit.mock.calls[0] as [{ items: Record<string, unknown>[] }]
    expect('url' in emitted.items[0]).toBe(false)
    expect(emitted.items[0].id).toBe('prod_1')
    expect(emitted.items[0].title).toBe('Sweatshirt')
    expect(emitted.items[0].handle).toBe('sweatshirt')
  })

  it('blocking path (no emitStructured): still returns text, never throws, emits nothing', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { region_id: 'reg_dk', country_code: 'dk' } },
    })
    mockMedusaStoreFetch.mockResolvedValueOnce({ products: [productFixture()] })
    const { searchMedusaProducts } = await import('@/lib/medusa/actions/search-products')

    const result = await searchMedusaProducts({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toContain('Sweatshirt')
  })
})

describe('product_cards emit — getMedusaProduct (UIX-01 Task 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 })
  })

  it('single-item emit for the resolved product (by handle)', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { region_id: 'reg_dk', country_code: 'dk' } },
    })
    mockMedusaStoreFetch.mockResolvedValueOnce({ products: [productFixture()] })
    const emit = vi.fn()
    const { getMedusaProduct } = await import('@/lib/medusa/actions/get-product')

    await getMedusaProduct({ handle: 'sweatshirt' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
      emitStructured: emit,
    })

    expect(emit).toHaveBeenCalledTimes(1)
    const [emitted] = emit.mock.calls[0] as [{ event: string; component: string; items: Record<string, unknown>[] }]
    expect(emitted.event).toBe('ui')
    expect(emitted.component).toBe('product_cards')
    expect(emitted.items.length).toBe(1)
    expect(emitted.items[0]).toMatchObject({ id: 'prod_1', variantId: 'variant_1', title: 'Sweatshirt' })
  })

  it('blocking path (no emitStructured): still returns text, never throws', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { region_id: 'reg_dk', country_code: 'dk' } },
    })
    mockMedusaStoreFetch.mockResolvedValueOnce({ product: productFixture() })
    const { getMedusaProduct } = await import('@/lib/medusa/actions/get-product')

    const result = await getMedusaProduct({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toContain('Sweatshirt')
  })
})

// tests/medusa-wishlist.test.ts
// WSL-01/WSL-02: resolveWishlistOwner (anti-IDOR owner resolution) +
// addWishlistItem / removeWishlistItem / listWishlist executors. Copies the
// buildSupabase + mockRateLimit + mock-transport idioms from
// tests/medusa-cart-write.test.ts. See 135-RESEARCH.md and
// .planning/research/INTEGRATION-CONTRACT.md §4.2.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ---- Mocks -----------------------------------------------------------------
// medusaAgentFetch is mocked away entirely (so its own internal R11 rateLimit
// call never runs); the real error classes (MedusaApiError, MedusaRateLimitError)
// are kept via importOriginal so `instanceof` checks in the executors still work.
const mockMedusaAgentFetch = vi.fn()
vi.mock('@/lib/medusa/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/medusa/client')>()
  return {
    ...actual,
    medusaAgentFetch: (...args: unknown[]) => mockMedusaAgentFetch(...args),
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
// resolveWishlistOwner
// =============================================================================

describe('resolveWishlistOwner — anti-IDOR owner resolution (WSL-01)', () => {
  it('returns { customer_id } when commerce.cus is a non-empty string', async () => {
    const { resolveWishlistOwner } = await import('@/lib/medusa/wishlist-owner')
    expect(resolveWishlistOwner({ cus: 'cus_9' })).toEqual({ customer_id: 'cus_9' })
  })

  it('returns { guest_ref } when commerce.wishlist_ref is a non-empty string', async () => {
    const { resolveWishlistOwner } = await import('@/lib/medusa/wishlist-owner')
    expect(resolveWishlistOwner({ wishlist_ref: 'w-1' })).toEqual({ guest_ref: 'w-1' })
  })

  it('prefers cus when BOTH cus and wishlist_ref are present', async () => {
    const { resolveWishlistOwner } = await import('@/lib/medusa/wishlist-owner')
    expect(resolveWishlistOwner({ cus: 'cus_9', wishlist_ref: 'w-1' })).toEqual({ customer_id: 'cus_9' })
  })

  it('returns null when commerce is empty', async () => {
    const { resolveWishlistOwner } = await import('@/lib/medusa/wishlist-owner')
    expect(resolveWishlistOwner({})).toBeNull()
  })

  it('falls through to wishlist_ref when cus is an empty string', async () => {
    const { resolveWishlistOwner } = await import('@/lib/medusa/wishlist-owner')
    expect(resolveWishlistOwner({ cus: '', wishlist_ref: 'w-1' })).toEqual({ guest_ref: 'w-1' })
  })
})

// =============================================================================
// addWishlistItem
// =============================================================================

describe('addWishlistItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 })
  })

  it('happy path: pinned cus, saves + returns friendly idempotent-safe string', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    mockMedusaAgentFetch.mockResolvedValueOnce({
      item: { id: 'wi_1', product_id: 'prod_1', variant_id: null, product: { title: 'Sweatshirt', handle: 'sweatshirt', thumbnail: null } },
    })
    const { addWishlistItem } = await import('@/lib/medusa/actions/wishlist-add')

    const result = await addWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toContain('Sweatshirt')
    expect(result).toMatch(/saved/i)
    expect(mockMedusaAgentFetch).toHaveBeenCalledTimes(1)
    const [, path, , body] = mockMedusaAgentFetch.mock.calls[0] as [unknown, string, unknown, Record<string, unknown>]
    expect(path).toBe('/agent/wishlists/add')
    expect(body).toEqual({ customer_id: 'cus_9', product_id: 'prod_1' })
  })

  it('with variant: body includes variant_id', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    mockMedusaAgentFetch.mockResolvedValueOnce({
      item: { id: 'wi_1', product_id: 'prod_1', variant_id: 'variant_01A', product: { title: 'Sweatshirt' } },
    })
    const { addWishlistItem } = await import('@/lib/medusa/actions/wishlist-add')

    await addWishlistItem({ product_id: 'prod_1', variant_id: 'variant_01A' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    const [, , , body] = mockMedusaAgentFetch.mock.calls[0] as [unknown, string, unknown, Record<string, unknown>]
    expect(body).toEqual({ customer_id: 'cus_9', product_id: 'prod_1', variant_id: 'variant_01A' })
  })

  it('no owner: returns friendly "nothing saved yet" string, NO store call', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: {} } })
    const { addWishlistItem } = await import('@/lib/medusa/actions/wishlist-add')

    const result = await addWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toMatch(/nothing.*saved|saved.*yet/i)
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
  })

  it('missing product_id: returns "tell me which product" string, NO store call', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    const { addWishlistItem } = await import('@/lib/medusa/actions/wishlist-add')

    const result = await addWishlistItem({}, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toMatch(/which product/i)
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
  })

  it('409 wishlist_full: returns friendly "full (100 items)" string, never throws', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    const { MedusaApiError } = await import('@/lib/medusa/client')
    mockMedusaAgentFetch.mockRejectedValueOnce(new MedusaApiError(409, '{"error":"wishlist_full"}'))
    const { addWishlistItem } = await import('@/lib/medusa/actions/wishlist-add')

    const result = await addWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toMatch(/full/i)
    expect(result).toContain('100')
  })

  it('R7 closed: denies, NO store call; key contains com:write: and failMode closed', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    const { addWishlistItem } = await import('@/lib/medusa/actions/wishlist-add')

    const result = await addWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(typeof result).toBe('string')
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
    const [key, , , opts] = mockRateLimit.mock.calls[0] as [string, number, number, { failMode: string }]
    expect(key).toContain('com:write:')
    expect(opts.failMode).toBe('closed')
  })

  it('R8 closed: R7 ok then R8 denies, NO store call', async () => {
    mockRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 9, resetAt: 0 }) // R7 ok
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 }) // R8 denies
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    const { addWishlistItem } = await import('@/lib/medusa/actions/wishlist-add')

    const result = await addWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(typeof result).toBe('string')
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
  })

  it('never throws — a transport error resolves to a friendly string', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    mockMedusaAgentFetch.mockRejectedValueOnce(new Error('boom'))
    const { addWishlistItem } = await import('@/lib/medusa/actions/wishlist-add')

    await expect(
      addWishlistItem({ product_id: 'prod_1' }, CREDS, {
        organizationId: 'org-1',
        supabase,
        conversationId: 'conv-1',
      }),
    ).resolves.toEqual(expect.any(String))
  })
})

// =============================================================================
// removeWishlistItem
// =============================================================================

describe('removeWishlistItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 })
  })

  it('happy path: pinned wishlist_ref, removes + returns idempotent-safe string', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { wishlist_ref: 'w-1' } } })
    mockMedusaAgentFetch.mockResolvedValueOnce({ removed: true })
    const { removeWishlistItem } = await import('@/lib/medusa/actions/wishlist-remove')

    const result = await removeWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toMatch(/removed/i)
    const [, path, , body] = mockMedusaAgentFetch.mock.calls[0] as [unknown, string, unknown, Record<string, unknown>]
    expect(path).toBe('/agent/wishlists/remove')
    expect(body).toEqual({ guest_ref: 'w-1', product_id: 'prod_1' })
  })

  it('no owner: returns friendly "nothing saved yet" string, NO store call', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: {} } })
    const { removeWishlistItem } = await import('@/lib/medusa/actions/wishlist-remove')

    const result = await removeWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toMatch(/nothing.*saved|saved.*yet/i)
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
  })

  it('R7 closed: denies, NO store call', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { wishlist_ref: 'w-1' } } })
    const { removeWishlistItem } = await import('@/lib/medusa/actions/wishlist-remove')

    const result = await removeWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(typeof result).toBe('string')
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
  })

  it('R8 closed: R7 ok then R8 denies, NO store call', async () => {
    mockRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 9, resetAt: 0 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { wishlist_ref: 'w-1' } } })
    const { removeWishlistItem } = await import('@/lib/medusa/actions/wishlist-remove')

    const result = await removeWishlistItem({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(typeof result).toBe('string')
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
  })

  it('never throws — a transport error resolves to a friendly string', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { wishlist_ref: 'w-1' } } })
    mockMedusaAgentFetch.mockRejectedValueOnce(new Error('boom'))
    const { removeWishlistItem } = await import('@/lib/medusa/actions/wishlist-remove')

    await expect(
      removeWishlistItem({ product_id: 'prod_1' }, CREDS, {
        organizationId: 'org-1',
        supabase,
        conversationId: 'conv-1',
      }),
    ).resolves.toEqual(expect.any(String))
  })
})

// =============================================================================
// listWishlist
// =============================================================================

describe('listWishlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: 0 })
  })

  it('happy path: renders items, body is owner-only, path correct', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    mockMedusaAgentFetch.mockResolvedValueOnce({
      wishlist: {
        id: 'wl_1',
        items: [
          { id: 'wi_1', product_id: 'p1', variant_id: null, product: { title: 'Sweatshirt', handle: 'sweatshirt', thumbnail: null } },
          { id: 'wi_2', product_id: 'p2', variant_id: null, product: { title: 'Tote', handle: 'tote', thumbnail: null } },
        ],
      },
    })
    const { listWishlist } = await import('@/lib/medusa/actions/wishlist-list')

    const result = await listWishlist(CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' })

    expect(result).toContain('Sweatshirt')
    expect(result).toContain('Tote')
    const [, path, , body] = mockMedusaAgentFetch.mock.calls[0] as [unknown, string, unknown, Record<string, unknown>]
    expect(path).toBe('/agent/wishlists/list')
    expect(body).toEqual({ customer_id: 'cus_9' })
  })

  it('empty wishlist: returns "Your wishlist is empty."', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    mockMedusaAgentFetch.mockResolvedValueOnce({ wishlist: { id: 'wl_1', items: [] } })
    const { listWishlist } = await import('@/lib/medusa/actions/wishlist-list')

    const result = await listWishlist(CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' })

    expect(result).toBe('Your wishlist is empty.')
  })

  it('no owner: friendly "nothing saved yet" string, NO store call', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: {} } })
    const { listWishlist } = await import('@/lib/medusa/actions/wishlist-list')

    const result = await listWishlist(CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' })

    expect(result).toMatch(/nothing.*saved|saved.*yet/i)
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
  })

  it('R6 memory: key contains com:read: and failMode memory; denies -> friendly string, no call', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    const { listWishlist } = await import('@/lib/medusa/actions/wishlist-list')

    const result = await listWishlist(CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' })

    expect(typeof result).toBe('string')
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
    const [key, , , opts] = mockRateLimit.mock.calls[0] as [string, number, number, { failMode: string }]
    expect(key).toContain('com:read:')
    expect(opts.failMode).toBe('memory')
  })

  it('never throws — a transport error resolves to a friendly string', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cus: 'cus_9' } } })
    mockMedusaAgentFetch.mockRejectedValueOnce(new Error('boom'))
    const { listWishlist } = await import('@/lib/medusa/actions/wishlist-list')

    await expect(
      listWishlist(CREDS, { organizationId: 'org-1', supabase, conversationId: 'conv-1' }),
    ).resolves.toEqual(expect.any(String))
  })
})

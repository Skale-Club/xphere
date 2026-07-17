import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { GhlCredentials } from '@/lib/ghl/client'

const mockGetMedusaCredentialsForOrg = vi.fn()
vi.mock('@/lib/medusa/credentials', () => ({
  getMedusaCredentialsForOrg: (...args: unknown[]) => mockGetMedusaCredentialsForOrg(...args),
}))

const mockSearchMedusaProducts = vi.fn().mockResolvedValue('SENTINEL_SEARCH')
vi.mock('@/lib/medusa/actions/search-products', () => ({
  searchMedusaProducts: (...args: unknown[]) => mockSearchMedusaProducts(...args),
}))

const mockGetMedusaProduct = vi.fn().mockResolvedValue('SENTINEL_PRODUCT')
vi.mock('@/lib/medusa/actions/get-product', () => ({
  getMedusaProduct: (...args: unknown[]) => mockGetMedusaProduct(...args),
}))

const mockGetMedusaCart = vi.fn().mockResolvedValue('SENTINEL_CART')
vi.mock('@/lib/medusa/actions/get-cart', () => ({
  getMedusaCart: (...args: unknown[]) => mockGetMedusaCart(...args),
}))

const mockAddToCartMedusa = vi.fn().mockResolvedValue('SENTINEL_ADD_TO_CART')
vi.mock('@/lib/medusa/actions/add-to-cart', () => ({
  addToCartMedusa: (...args: unknown[]) => mockAddToCartMedusa(...args),
}))

const mockUpdateCartItemMedusa = vi.fn().mockResolvedValue('SENTINEL_UPDATE_CART_ITEM')
vi.mock('@/lib/medusa/actions/update-cart-item', () => ({
  updateCartItemMedusa: (...args: unknown[]) => mockUpdateCartItemMedusa(...args),
}))

const mockAddWishlistItem = vi.fn().mockResolvedValue('SENTINEL_WISHLIST_ADD')
vi.mock('@/lib/medusa/actions/wishlist-add', () => ({
  addWishlistItem: (...args: unknown[]) => mockAddWishlistItem(...args),
}))

const mockRemoveWishlistItem = vi.fn().mockResolvedValue('SENTINEL_WISHLIST_REMOVE')
vi.mock('@/lib/medusa/actions/wishlist-remove', () => ({
  removeWishlistItem: (...args: unknown[]) => mockRemoveWishlistItem(...args),
}))

const mockListWishlist = vi.fn().mockResolvedValue('SENTINEL_WISHLIST_LIST')
vi.mock('@/lib/medusa/actions/wishlist-list', () => ({
  listWishlist: (...args: unknown[]) => mockListWishlist(...args),
}))

const mockGetOrderStatus = vi.fn().mockResolvedValue('SENTINEL_ORDER_STATUS')
vi.mock('@/lib/medusa/actions/get-order-status', () => ({
  getOrderStatus: (...args: unknown[]) => mockGetOrderStatus(...args),
}))

const CREDS: GhlCredentials = { apiKey: '', locationId: '' }
const MEDUSA_CREDS = { baseUrl: 'http://localhost:9000', connectionToken: 'tok', publishableKey: 'pk_test' }

function makeSupabase() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  return { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>
}

describe('execute-action medusa dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes medusa_search_products to searchMedusaProducts', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_search_products' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('SENTINEL_SEARCH')
    expect(mockSearchMedusaProducts).toHaveBeenCalledOnce()
  })

  it('routes medusa_get_product to getMedusaProduct', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_get_product' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('SENTINEL_PRODUCT')
    expect(mockGetMedusaProduct).toHaveBeenCalledOnce()
  })

  it('routes medusa_get_cart to getMedusaCart', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_get_cart' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('SENTINEL_CART')
    expect(mockGetMedusaCart).toHaveBeenCalledOnce()
  })

  it('never throws when ctx is missing -- returns a friendly string', async () => {
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_get_cart' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, undefined)
    expect(result).toBe('The store is not available right now.')
    expect(mockGetMedusaCredentialsForOrg).not.toHaveBeenCalled()
  })

  it('never throws when no store is connected -- returns a friendly string', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(null)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_search_products' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('No store is connected to this workspace yet.')
    expect(mockSearchMedusaProducts).not.toHaveBeenCalled()
  })

  it('routes medusa_add_to_cart to addToCartMedusa', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_add_to_cart' as unknown as Database['public']['Enums']['action_type'], { product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('SENTINEL_ADD_TO_CART')
    expect(mockAddToCartMedusa).toHaveBeenCalledOnce()
    expect(mockUpdateCartItemMedusa).not.toHaveBeenCalled()
  })

  it('routes medusa_update_cart_item to updateCartItemMedusa', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_update_cart_item' as unknown as Database['public']['Enums']['action_type'], { item_title_or_variant: 'Sweatshirt', quantity: 2 }, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('SENTINEL_UPDATE_CART_ITEM')
    expect(mockUpdateCartItemMedusa).toHaveBeenCalledOnce()
    expect(mockAddToCartMedusa).not.toHaveBeenCalled()
  })

  it('medusa_add_to_cart never throws when ctx is missing -- returns a friendly string', async () => {
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_add_to_cart' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, undefined)
    expect(result).toBe('The store is not available right now.')
    expect(mockAddToCartMedusa).not.toHaveBeenCalled()
  })

  it('medusa_update_cart_item never throws when no store is connected -- returns a friendly string', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(null)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_update_cart_item' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('No store is connected to this workspace yet.')
    expect(mockUpdateCartItemMedusa).not.toHaveBeenCalled()
  })

  it('routes medusa_wishlist_add to addWishlistItem', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_wishlist_add' as unknown as Database['public']['Enums']['action_type'], { product_id: 'p1' }, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('SENTINEL_WISHLIST_ADD')
    expect(mockAddWishlistItem).toHaveBeenCalledOnce()
    expect(mockRemoveWishlistItem).not.toHaveBeenCalled()
    expect(mockListWishlist).not.toHaveBeenCalled()
  })

  it('routes medusa_wishlist_remove to removeWishlistItem', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_wishlist_remove' as unknown as Database['public']['Enums']['action_type'], { product_id: 'p1' }, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('SENTINEL_WISHLIST_REMOVE')
    expect(mockRemoveWishlistItem).toHaveBeenCalledOnce()
    expect(mockAddWishlistItem).not.toHaveBeenCalled()
    expect(mockListWishlist).not.toHaveBeenCalled()
  })

  it('routes medusa_wishlist_list to listWishlist', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_wishlist_list' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('SENTINEL_WISHLIST_LIST')
    expect(mockListWishlist).toHaveBeenCalledOnce()
    expect(mockAddWishlistItem).not.toHaveBeenCalled()
    expect(mockRemoveWishlistItem).not.toHaveBeenCalled()
  })

  it('medusa_wishlist_add never throws when ctx is missing -- returns a friendly string', async () => {
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_wishlist_add' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, undefined)
    expect(result).toBe('The store is not available right now.')
    expect(mockAddWishlistItem).not.toHaveBeenCalled()
  })

  it('medusa_wishlist_list never throws when no store is connected -- returns a friendly string', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(null)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_wishlist_list' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('No store is connected to this workspace yet.')
    expect(mockListWishlist).not.toHaveBeenCalled()
  })

  it('routes medusa_get_order_status to getOrderStatus', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(MEDUSA_CREDS)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const ctx = {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    }
    const params = { display_id: 5 }
    const result = await executeAction('medusa_get_order_status' as unknown as Database['public']['Enums']['action_type'], params, CREDS, ctx)
    expect(result).toBe('SENTINEL_ORDER_STATUS')
    expect(mockGetOrderStatus).toHaveBeenCalledOnce()
    expect(mockGetOrderStatus).toHaveBeenCalledWith(params, MEDUSA_CREDS, ctx)
  })

  it('medusa_get_order_status never throws when no store is connected -- returns a friendly string', async () => {
    mockGetMedusaCredentialsForOrg.mockResolvedValue(null)
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('medusa_get_order_status' as unknown as Database['public']['Enums']['action_type'], {}, CREDS, {
      organizationId: 'org-1',
      supabase: makeSupabase(),
      conversationId: 'conv-1',
    })
    expect(result).toBe('No store is connected to this workspace yet.')
    expect(mockGetOrderStatus).not.toHaveBeenCalled()
  })

  it('database.ts action_type Enums union includes all nine medusa_* values', () => {
    const src = readFileSync(join(process.cwd(), 'src/types/database.ts'), 'utf-8')
    const enumsMatch = src.match(/action_type:\s*'send_email'[^\n]*'send_zernio_dm'[^\n]*/g)
    expect(enumsMatch, 'action_type union ending in send_zernio_dm not found').toBeTruthy()
    const nine = [
      'medusa_search_products',
      'medusa_get_product',
      'medusa_get_cart',
      'medusa_add_to_cart',
      'medusa_update_cart_item',
      'medusa_wishlist_add',
      'medusa_wishlist_remove',
      'medusa_wishlist_list',
      'medusa_get_order_status',
    ]
    for (const line of enumsMatch ?? []) {
      for (const value of nine) {
        expect(line, `${value} missing from an action_type union`).toContain(`'${value}'`)
      }
    }
    // Both the Enums union (L8108) and _legacy_tool_configs Row (L1349) must be widened.
    expect(enumsMatch?.length).toBeGreaterThanOrEqual(2)
  })

  it('execute-action.ts dispatches all nine medusa_* action types to real executors -- no stubs remain', () => {
    // Phase 137 Wave 2: medusa_get_order_status now dispatches to
    // getOrderStatus (asserted above) -- the "not available yet" stub group
    // introduced in 132-04 is now fully empty; the exhaustive switch stays
    // exhaustive purely on real cases.
    const src = readFileSync(join(process.cwd(), 'src/lib/action-engine/execute-action.ts'), 'utf-8')
    expect(src).toContain("case 'medusa_get_order_status':")
    expect(src).not.toContain('not available yet')
    expect(src).toContain('getOrderStatus(params, medusaCreds, ctx)')
    expect(src).toContain('addToCartMedusa')
    expect(src).toContain('updateCartItemMedusa')
    expect(src).toContain('addWishlistItem')
    expect(src).toContain('removeWishlistItem')
    expect(src).toContain('listWishlist')
  })

  it('SIDE_EFFECTING_ACTIONS registers wishlist add/remove but not list; COMMERCE_WRITE_ACTIONS unchanged', async () => {
    const { SIDE_EFFECTING_ACTIONS, COMMERCE_WRITE_ACTIONS } = await import('@/lib/agent-runtime/idempotency')
    expect(SIDE_EFFECTING_ACTIONS.has('medusa_wishlist_add')).toBe(true)
    expect(SIDE_EFFECTING_ACTIONS.has('medusa_wishlist_remove')).toBe(true)
    expect(SIDE_EFFECTING_ACTIONS.has('medusa_wishlist_list')).toBe(false)
    expect(COMMERCE_WRITE_ACTIONS.has('medusa_wishlist_add')).toBe(false)
    expect(COMMERCE_WRITE_ACTIONS.has('medusa_wishlist_remove')).toBe(false)
    expect(COMMERCE_WRITE_ACTIONS.size).toBe(2)
  })
})

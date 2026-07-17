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

  it('execute-action.ts stubs the six not-yet-built medusa actions so the switch stays exhaustive', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/action-engine/execute-action.ts'), 'utf-8')
    expect(src).toContain("case 'medusa_get_order_status':")
    expect(src).toContain('That commerce action is not available yet.')
  })
})

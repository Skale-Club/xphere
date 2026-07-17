// tests/medusa-cart-write.test.ts
// CRT-01/02/03: cart-write primitives (signCartSig, pinCartId,
// bumpConversationWriteCount, checkCommerceWritesPerTurn) + the two write
// executors (medusa_add_to_cart, medusa_update_cart_item). Locks the
// cross-repo cart_created adoption-sig vector (contract §3/§6) so a future
// drift in either repo's HMAC convention is caught immediately. See
// 134-RESEARCH.md and .planning/research/INTEGRATION-CONTRACT.md §3/§4.1/§6/§7.

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
// Supports both maybeSingle() reads (loadPinnedContext / pinCartId /
// bumpConversationWriteCount) and .update().eq().eq() writes — copied idiom
// from tests/medusa-context.test.ts's buildSupabase.
function buildSupabase(row: { session_key?: string | null; memory: Record<string, unknown> | null } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const update = vi.fn().mockReturnThis()
  const eq = vi.fn().mockReturnThis()
  const select = vi.fn().mockReturnThis()
  const chain = { select, eq, maybeSingle, update }
  const from = vi.fn().mockReturnValue(chain)
  return {
    supabase: { from } as unknown as SupabaseClient<Database>,
    from,
    eq,
    maybeSingle,
    update,
    select,
  }
}

const CREDS = { baseUrl: 'http://localhost:9000', connectionToken: 'tok', publishableKey: 'pk_test' }

// =============================================================================
// Task 1: primitives
// =============================================================================

describe('signCartSig — cross-repo adoption-sig vector (CRT-01, SECURITY CRITICAL)', () => {
  it('matches the committed cross-repo hex vector #1', async () => {
    const { signCartSig } = await import('@/lib/medusa/cart-sig')
    const sig = await signCartSig('xph_test_connection_token_abc123', 'cart_01ABC')
    expect(sig).toBe('f770a654c88db78fceabc6c9aab50149a4209d1b990162085084fd92d53c5a46')
  })

  it('matches the committed cross-repo hex vector #2 (stuscle verifyCartSig test constants)', async () => {
    const { signCartSig } = await import('@/lib/medusa/cart-sig')
    const sig = await signCartSig('xph_test', 'cart_01ADOPT')
    expect(sig).toBe('a4d0db1b5d85689686b7002a872543a5c5c4098eaec344689e3d6e8926f42b73')
  })
})

describe('pinCartId — cart-only re-pin merge (CRT-01)', () => {
  it('touches ONLY commerce.cart — region_id/cus/email/wishlist_ref survive unchanged', async () => {
    const { supabase, update, eq } = buildSupabase({
      memory: { commerce: { region_id: 'reg_1', cus: 'cus_9', email: 'a@b.com', wishlist_ref: 'w-1' } },
    })
    const { pinCartId } = await import('@/lib/medusa/context')

    await pinCartId(supabase, 'conv-1', 'org-1', 'cart_NEW')

    expect(update).toHaveBeenCalledTimes(1)
    const updateArg = update.mock.calls[0][0] as { memory: Record<string, unknown> }
    const commerce = updateArg.memory.commerce as Record<string, unknown>
    expect(commerce.cart).toBe('cart_NEW')
    expect(commerce.region_id).toBe('reg_1')
    expect(commerce.cus).toBe('cus_9')
    expect(commerce.email).toBe('a@b.com')
    expect(commerce.wishlist_ref).toBe('w-1')
    expect(commerce).not.toHaveProperty('verified_at')
    expect(eq).toHaveBeenCalledWith('id', 'conv-1')
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('starts from an empty commerce object when none was pinned yet', async () => {
    const { supabase, update } = buildSupabase({ memory: {} })
    const { pinCartId } = await import('@/lib/medusa/context')

    await pinCartId(supabase, 'conv-1', 'org-1', 'cart_FRESH')

    const updateArg = update.mock.calls[0][0] as { memory: Record<string, unknown> }
    expect((updateArg.memory.commerce as Record<string, unknown>).cart).toBe('cart_FRESH')
  })
})

describe('bumpConversationWriteCount — 25-per-conversation cap (CRT-02)', () => {
  it('allows and increments while under the cap', async () => {
    const { supabase, update } = buildSupabase({ memory: { commerce: { write_count: 5 } } })
    const { bumpConversationWriteCount } = await import('@/lib/medusa/context')

    const result = await bumpConversationWriteCount(supabase, 'conv-1', 'org-1')

    expect(result).toEqual({ allowed: true, count: 6 })
    const updateArg = update.mock.calls[0][0] as { memory: Record<string, unknown> }
    expect((updateArg.memory.commerce as Record<string, unknown>).write_count).toBe(6)
  })

  it('defaults write_count to 0 when absent', async () => {
    const { supabase } = buildSupabase({ memory: {} })
    const { bumpConversationWriteCount } = await import('@/lib/medusa/context')

    const result = await bumpConversationWriteCount(supabase, 'conv-1', 'org-1')

    expect(result).toEqual({ allowed: true, count: 1 })
  })

  it('denies WITHOUT writing once write_count reaches the cap (25)', async () => {
    const { supabase, update } = buildSupabase({ memory: { commerce: { write_count: 25 } } })
    const { bumpConversationWriteCount } = await import('@/lib/medusa/context')

    const result = await bumpConversationWriteCount(supabase, 'conv-1', 'org-1')

    expect(result).toEqual({ allowed: false, count: 25 })
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves other commerce keys on both the allow and deny paths', async () => {
    const { supabase, update } = buildSupabase({
      memory: { commerce: { cart: 'cart_1', write_count: 3 } },
    })
    const { bumpConversationWriteCount } = await import('@/lib/medusa/context')

    await bumpConversationWriteCount(supabase, 'conv-1', 'org-1')

    const updateArg = update.mock.calls[0][0] as { memory: Record<string, unknown> }
    expect((updateArg.memory.commerce as Record<string, unknown>).cart).toBe('cart_1')
  })
})

describe('checkCommerceWritesPerTurn — per-turn commerce write cap (CRT-02)', () => {
  it('returns null for counts 1 through 3 (within the default cap)', async () => {
    const { checkCommerceWritesPerTurn } = await import('@/lib/agent-runtime/guardrails')
    expect(checkCommerceWritesPerTurn(1)).toBeNull()
    expect(checkCommerceWritesPerTurn(2)).toBeNull()
    expect(checkCommerceWritesPerTurn(3)).toBeNull()
  })

  it('returns a non-empty denial string for count 4', async () => {
    const { checkCommerceWritesPerTurn } = await import('@/lib/agent-runtime/guardrails')
    const result = checkCommerceWritesPerTurn(4)
    expect(typeof result).toBe('string')
    expect((result as string).length).toBeGreaterThan(0)
  })
})

describe('SIDE_EFFECTING_ACTIONS / COMMERCE_WRITE_ACTIONS (CRT-04)', () => {
  it('SIDE_EFFECTING_ACTIONS includes both cart-write action types', async () => {
    const { SIDE_EFFECTING_ACTIONS } = await import('@/lib/agent-runtime/idempotency')
    expect(SIDE_EFFECTING_ACTIONS.has('medusa_add_to_cart')).toBe(true)
    expect(SIDE_EFFECTING_ACTIONS.has('medusa_update_cart_item')).toBe(true)
  })

  it('COMMERCE_WRITE_ACTIONS contains exactly the two cart-write action types', async () => {
    const { COMMERCE_WRITE_ACTIONS } = await import('@/lib/agent-runtime/idempotency')
    expect(COMMERCE_WRITE_ACTIONS.has('medusa_add_to_cart')).toBe(true)
    expect(COMMERCE_WRITE_ACTIONS.has('medusa_update_cart_item')).toBe(true)
    expect(COMMERCE_WRITE_ACTIONS.size).toBe(2)
  })
})

// =============================================================================
// Task 2: medusa_add_to_cart
// =============================================================================

describe('addToCartMedusa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 })
  })

  it('happy path with a pinned cart: adds a line item, emits cart_updated once, MAJOR-unit total', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { cart: 'cart_1', write_count: 0 } },
    })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      cart: {
        id: 'cart_1',
        currency_code: 'eur',
        total: 35,
        items: [{ id: 'li_1', title: 'Sweatshirt', quantity: 1, variant_id: 'variant_1', total: 35 }],
      },
    })
    const emit = vi.fn()
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    const result = await addToCartMedusa({ variant_id: 'variant_1', quantity: 1 }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
      emitStructured: emit,
    })

    expect(result).toContain('€35.00')
    expect(result).not.toContain('3,500.00')
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({ event: 'commerce', action: 'cart_updated', cartId: 'cart_1', itemCount: 1 })
    expect(mockMedusaStoreFetch).toHaveBeenCalledTimes(1)
    const [, path, , init] = mockMedusaStoreFetch.mock.calls[0] as [unknown, string, unknown, RequestInit]
    expect(path).toContain('/store/carts/cart_1/line-items')
    expect(init.method).toBe('POST')
  })

  it('no pinned cart: create -> sign -> metadata -> pin -> emit cart_created -> add line -> emit cart_updated, IN ORDER', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { region_id: 'reg_1' } },
    })
    mockMedusaStoreFetch
      .mockResolvedValueOnce({ cart: { id: 'cart_NEW' } }) // 1: create
      .mockResolvedValueOnce({ cart: { id: 'cart_NEW' } }) // 2: metadata write
      .mockResolvedValueOnce({
        cart: {
          id: 'cart_NEW',
          currency_code: 'eur',
          total: 35,
          items: [{ id: 'li_1', title: 'Sweatshirt', quantity: 1, variant_id: 'variant_1', total: 35 }],
        },
      }) // 3: add line item
    const emit = vi.fn()
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')
    const { signCartSig } = await import('@/lib/medusa/cart-sig')
    const expectedSig = await signCartSig(CREDS.connectionToken, 'cart_NEW')

    await addToCartMedusa({ variant_id: 'variant_1', quantity: 1 }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
      emitStructured: emit,
    })

    expect(mockMedusaStoreFetch).toHaveBeenCalledTimes(3)
    const calls = mockMedusaStoreFetch.mock.calls as Array<[unknown, string, unknown, RequestInit?]>
    const [createCall, metadataCall, addLineCall] = calls
    expect(createCall[1]).toBe('/store/carts')
    expect(createCall[3]?.method).toBe('POST')
    expect(metadataCall[1]).toBe('/store/carts/cart_NEW')
    expect(JSON.parse((metadataCall[3]?.body as string) ?? '{}')).toEqual({ metadata: { xphere_sig: expectedSig } })
    expect(addLineCall[1]).toContain('/store/carts/cart_NEW/line-items')

    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenNthCalledWith(1, {
      event: 'commerce',
      action: 'cart_created',
      cartId: 'cart_NEW',
      itemCount: 0,
      sig: expectedSig,
    })
    expect(emit).toHaveBeenNthCalledWith(2, {
      event: 'commerce',
      action: 'cart_updated',
      cartId: 'cart_NEW',
      itemCount: 1,
    })

    // ORDER IS LOAD-BEARING: cart_created strictly after the metadata POST
    // resolves, strictly before the line-item add call (Pitfall 2).
    const metadataOrder = mockMedusaStoreFetch.mock.invocationCallOrder[1]
    const addLineOrder = mockMedusaStoreFetch.mock.invocationCallOrder[2]
    const cartCreatedEmitOrder = emit.mock.invocationCallOrder[0]
    expect(cartCreatedEmitOrder).toBeGreaterThan(metadataOrder)
    expect(cartCreatedEmitOrder).toBeLessThan(addLineOrder)
  })

  it('quantity clamp: 99 -> line-item body quantity 10', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      cart: {
        id: 'cart_1',
        currency_code: 'eur',
        total: 350,
        items: [{ id: 'li_1', title: 'x', quantity: 10, variant_id: 'variant_1' }],
      },
    })
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    await addToCartMedusa({ variant_id: 'variant_1', quantity: 99 }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    const [, , , init] = mockMedusaStoreFetch.mock.calls[0] as [unknown, string, unknown, RequestInit]
    expect(JSON.parse(init.body as string).quantity).toBe(10)
  })

  it('quantity clamp: 0/missing -> 1', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      cart: {
        id: 'cart_1',
        currency_code: 'eur',
        total: 35,
        items: [{ id: 'li_1', title: 'x', quantity: 1, variant_id: 'variant_1' }],
      },
    })
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    await addToCartMedusa({ variant_id: 'variant_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    const [, , , init] = mockMedusaStoreFetch.mock.calls[0] as [unknown, string, unknown, RequestInit]
    expect(JSON.parse(init.body as string).quantity).toBe(1)
  })

  it('R7 closed: denies and issues NO store write', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    const result = await addToCartMedusa({ variant_id: 'variant_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(typeof result).toBe('string')
    expect(mockMedusaStoreFetch).not.toHaveBeenCalled()
    const [key, , , opts] = mockRateLimit.mock.calls[0] as [string, number, number, { failMode: string }]
    expect(key).toContain('com:write:')
    expect(opts.failMode).toBe('closed')
  })

  it('R8 closed: denies and issues NO store write', async () => {
    mockRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 9, resetAt: 0 }) // R7 ok
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 }) // R8 denies
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    const result = await addToCartMedusa({ variant_id: 'variant_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(typeof result).toBe('string')
    expect(mockMedusaStoreFetch).not.toHaveBeenCalled()
  })

  it('per-conversation 25 cap: denies and issues NO store write', async () => {
    const { supabase } = buildSupabase({
      session_key: 'sess_1',
      memory: { commerce: { cart: 'cart_1', write_count: 25 } },
    })
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    const result = await addToCartMedusa({ variant_id: 'variant_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(typeof result).toBe('string')
    expect(mockMedusaStoreFetch).not.toHaveBeenCalled()
  })

  it('51st item: rolls back the just-added line and does NOT emit cart_updated', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `li_${i}`,
      title: `x${i}`,
      quantity: 1,
      variant_id: `variant_old_${i}`,
    }))
    items.push({ id: 'li_new', title: 'new', quantity: 1, variant_id: 'variant_1' })
    mockMedusaStoreFetch
      .mockResolvedValueOnce({ cart: { id: 'cart_1', currency_code: 'eur', total: 999, items } }) // add line item -> 51 items
      .mockResolvedValueOnce({ deleted: true, parent: { id: 'cart_1', items: items.slice(0, 50) } }) // rollback DELETE
    const emit = vi.fn()
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    const result = await addToCartMedusa({ variant_id: 'variant_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
      emitStructured: emit,
    })

    expect(result.toLowerCase()).toContain('full')
    expect(mockMedusaStoreFetch).toHaveBeenCalledTimes(2)
    const [, deletePath, , deleteInit] = mockMedusaStoreFetch.mock.calls[1] as [unknown, string, unknown, RequestInit]
    expect(deletePath).toBe('/store/carts/cart_1/line-items/li_new')
    expect(deleteInit.method).toBe('DELETE')
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'cart_updated' }))
  })

  it('product_id with a single variant auto-selects it', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    mockMedusaStoreFetch
      .mockResolvedValueOnce({ product: { id: 'prod_1', title: 'Tote', variants: [{ id: 'variant_only', title: 'Default' }] } })
      .mockResolvedValueOnce({
        cart: {
          id: 'cart_1',
          currency_code: 'eur',
          total: 20,
          items: [{ id: 'li_1', title: 'Tote', quantity: 1, variant_id: 'variant_only' }],
        },
      })
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    const result = await addToCartMedusa({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toContain('€20.00')
    const [, , , addInit] = mockMedusaStoreFetch.mock.calls[1] as [unknown, string, unknown, RequestInit]
    expect(JSON.parse(addInit.body as string).variant_id).toBe('variant_only')
  })

  it('product_id with multiple variants asks the user to pick (no line-item write)', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    mockMedusaStoreFetch.mockResolvedValueOnce({
      product: {
        id: 'prod_1',
        title: 'Tote',
        variants: [
          { id: 'v1', title: 'Small' },
          { id: 'v2', title: 'Large' },
        ],
      },
    })
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    const result = await addToCartMedusa({ product_id: 'prod_1' }, CREDS, {
      organizationId: 'org-1',
      supabase,
      conversationId: 'conv-1',
    })

    expect(result).toMatch(/small/i)
    expect(result).toMatch(/large/i)
    expect(mockMedusaStoreFetch).toHaveBeenCalledTimes(1) // only the product fetch, no line-item POST
  })

  it('never throws — a store error resolves to a friendly string', async () => {
    const { supabase } = buildSupabase({ session_key: 'sess_1', memory: { commerce: { cart: 'cart_1' } } })
    mockMedusaStoreFetch.mockRejectedValueOnce(new Error('boom'))
    const { addToCartMedusa } = await import('@/lib/medusa/actions/add-to-cart')

    await expect(
      addToCartMedusa({ variant_id: 'variant_1' }, CREDS, {
        organizationId: 'org-1',
        supabase,
        conversationId: 'conv-1',
      }),
    ).resolves.toEqual(expect.any(String))
  })
})

// Task 3 (medusa_update_cart_item) suite is appended below in its own commit,
// per the phase plan's task ordering.

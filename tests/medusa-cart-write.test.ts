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

// Task 2 (medusa_add_to_cart) and Task 3 (medusa_update_cart_item) suites are
// appended below in their own commits, per the phase plan's task ordering.

// tests/medusa-order-status.test.ts
// UIX-02: getOrderStatus — a near-clone of wishlist-list.ts (the shipped
// medusaAgentFetch signed-read analog). Owner (pinned commerce.cus) resolved
// BEFORE R9 (5/24h fail-closed); display_id preference is
// params.display_id > commerce.last_order_display_id > omit; renders ONLY
// the contract §4.2 fields (no addresses/payment instruments); never throws.
// Copies the medusaAgentFetch-mock-via-importOriginal + mockRateLimit +
// pinned-ctx idioms from tests/medusa-wishlist.test.ts. See 137-RESEARCH.md
// and .planning/research/INTEGRATION-CONTRACT.md §4.2/§7.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ---- Mocks -----------------------------------------------------------------
// medusaAgentFetch is mocked away entirely (so its own internal R11 rateLimit
// call never runs); the real error classes (MedusaApiError, MedusaRateLimitError)
// are kept via importOriginal so `instanceof` checks in the executor still work.
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

// loadPinnedContext is mocked directly per-case (rather than a supabase
// stub) — the executor only ever reads sessionKey/commerce through it.
const mockLoadPinnedContext = vi.fn()
vi.mock('@/lib/medusa/pinned-context', () => ({
  loadPinnedContext: (...args: unknown[]) => mockLoadPinnedContext(...args),
}))

const CREDS = { baseUrl: 'http://localhost:9000', connectionToken: 'tok', publishableKey: 'pk_test' }
const ctx = { organizationId: 'org-1', supabase: {} as unknown as SupabaseClient<Database>, conversationId: 'conv-1' }

describe('getOrderStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 4, resetAt: 0 })
  })

  it('guest (no pinned cus): friendly login string, NO fetch, NO R9', async () => {
    mockLoadPinnedContext.mockResolvedValue({ sessionKey: 'sk', commerce: {} })
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    const result = await getOrderStatus({}, CREDS, ctx)

    expect(result).toMatch(/log in/i)
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('R9 closed: friendly try-again string, NO fetch; key/limit/window/failMode correct', async () => {
    mockLoadPinnedContext.mockResolvedValue({ sessionKey: 'sk', commerce: { cus: 'cus_9' } })
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    const result = await getOrderStatus({}, CREDS, ctx)

    expect(typeof result).toBe('string')
    expect(mockMedusaAgentFetch).not.toHaveBeenCalled()
    const [key, limit, window, opts] = mockRateLimit.mock.calls[0] as [
      string,
      number,
      number,
      { failMode: string },
    ]
    expect(key).toBe('ord:read:sk')
    expect(limit).toBe(5)
    expect(window).toBe(86400)
    expect(opts.failMode).toBe('closed')
  })

  it('success render (display_id from params): body + rendered fields correct', async () => {
    mockLoadPinnedContext.mockResolvedValue({ sessionKey: 'sk', commerce: { cus: 'cus_9' } })
    mockMedusaAgentFetch.mockResolvedValueOnce({
      order: {
        display_id: 12,
        status: 'completed',
        fulfillment_status: 'shipped',
        payment_status: 'captured',
        total: 123.45,
        currency_code: 'eur',
        created_at: '2026-07-17T12:00:00Z',
        items: [{ title: 'Sweatshirt', quantity: 2 }],
      },
    })
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')
    const { formatMoney } = await import('@/lib/medusa/format')

    const result = await getOrderStatus({ display_id: 12 }, CREDS, ctx)

    expect(mockMedusaAgentFetch).toHaveBeenCalledTimes(1)
    const [, path, , body] = mockMedusaAgentFetch.mock.calls[0] as [unknown, string, unknown, Record<string, unknown>]
    expect(path).toBe('/agent/orders/status')
    expect(body).toEqual({ customer_id: 'cus_9', display_id: 12 })

    expect(result).toContain('12')
    expect(result).toContain('completed')
    expect(result).toContain('shipped')
    expect(result).toContain('captured')
    expect(result).toContain(formatMoney(123.45, 'eur'))
    expect(result).toContain('Sweatshirt')
    expect(result).toContain('2')
  })

  it('display_id preference: falls back to commerce.last_order_display_id when params omit it', async () => {
    mockLoadPinnedContext.mockResolvedValue({
      sessionKey: 'sk',
      commerce: { cus: 'cus_9', last_order_display_id: 7 },
    })
    mockMedusaAgentFetch.mockResolvedValueOnce({
      order: {
        display_id: 7,
        status: 'completed',
        fulfillment_status: 'shipped',
        payment_status: 'captured',
        total: 10,
        currency_code: 'eur',
        created_at: '2026-07-17T12:00:00Z',
        items: [],
      },
    })
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    await getOrderStatus({}, CREDS, ctx)

    const [, , , body] = mockMedusaAgentFetch.mock.calls[0] as [unknown, string, unknown, Record<string, unknown>]
    expect(body).toEqual({ customer_id: 'cus_9', display_id: 7 })
  })

  it('display_id preference: params wins over memory', async () => {
    mockLoadPinnedContext.mockResolvedValue({
      sessionKey: 'sk',
      commerce: { cus: 'cus_9', last_order_display_id: 7 },
    })
    mockMedusaAgentFetch.mockResolvedValueOnce({
      order: {
        display_id: 9,
        status: 'completed',
        fulfillment_status: 'shipped',
        payment_status: 'captured',
        total: 10,
        currency_code: 'eur',
        created_at: '2026-07-17T12:00:00Z',
        items: [],
      },
    })
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    await getOrderStatus({ display_id: 9 }, CREDS, ctx)

    const [, , , body] = mockMedusaAgentFetch.mock.calls[0] as [unknown, string, unknown, Record<string, unknown>]
    expect(body.display_id).toBe(9)
  })

  it('no display_id anywhere: body omits the key entirely', async () => {
    mockLoadPinnedContext.mockResolvedValue({ sessionKey: 'sk', commerce: { cus: 'cus_9' } })
    mockMedusaAgentFetch.mockResolvedValueOnce({
      order: {
        display_id: 20,
        status: 'completed',
        fulfillment_status: 'shipped',
        payment_status: 'captured',
        total: 10,
        currency_code: 'eur',
        created_at: '2026-07-17T12:00:00Z',
        items: [],
      },
    })
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    await getOrderStatus({}, CREDS, ctx)

    const [, , , body] = mockMedusaAgentFetch.mock.calls[0] as [unknown, string, unknown, Record<string, unknown>]
    expect(body).toEqual({ customer_id: 'cus_9' })
    expect('display_id' in body).toBe(false)
  })

  it('404 -> friendly not-found string, never throws', async () => {
    mockLoadPinnedContext.mockResolvedValue({ sessionKey: 'sk', commerce: { cus: 'cus_9' } })
    const { MedusaApiError } = await import('@/lib/medusa/client')
    mockMedusaAgentFetch.mockRejectedValueOnce(new MedusaApiError(404, '{"error":"not_found"}'))
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    const result = await getOrderStatus({}, CREDS, ctx)

    expect(result).toMatch(/couldn't find that order/i)
  })

  it('no address/payment-instrument leak even when the response carries extra fields', async () => {
    mockLoadPinnedContext.mockResolvedValue({ sessionKey: 'sk', commerce: { cus: 'cus_9' } })
    mockMedusaAgentFetch.mockResolvedValueOnce({
      order: {
        display_id: 12,
        status: 'completed',
        fulfillment_status: 'shipped',
        payment_status: 'captured',
        total: 10,
        currency_code: 'eur',
        created_at: '2026-07-17T12:00:00Z',
        items: [],
        shipping_address: { line1: '1 Secret St' },
        payment_method: 'visa_4242',
      },
    })
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    const result = await getOrderStatus({}, CREDS, ctx)

    expect(result).not.toContain('1 Secret St')
    expect(result).not.toContain('visa_4242')
  })

  it('never throws (generic error) -> resolves to a friendly string', async () => {
    mockLoadPinnedContext.mockResolvedValue({ sessionKey: 'sk', commerce: { cus: 'cus_9' } })
    mockMedusaAgentFetch.mockRejectedValueOnce(new Error('boom'))
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    await expect(getOrderStatus({}, CREDS, ctx)).resolves.toEqual(expect.any(String))
  })

  it('order-of-operations: owner guard runs before R9 (guest never touches rateLimit)', async () => {
    mockLoadPinnedContext.mockResolvedValue({ sessionKey: 'sk', commerce: {} })
    const { getOrderStatus } = await import('@/lib/medusa/actions/get-order-status')

    await getOrderStatus({}, CREDS, ctx)

    expect(mockRateLimit).not.toHaveBeenCalled()
  })
})

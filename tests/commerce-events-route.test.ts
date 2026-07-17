import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommerceEventPayload } from '@/lib/commerce/ingestion-schema'

const { verifyApiKeyMock, rateLimitMock, insertCommerceReceiptMock, emitCommerceEventMock } = vi.hoisted(() => ({
  verifyApiKeyMock: vi.fn(),
  rateLimitMock: vi.fn(),
  insertCommerceReceiptMock: vi.fn(),
  emitCommerceEventMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => {
  const updateQuery = {
    update: () => updateQuery,
    eq: () => Promise.resolve({ data: null, error: null }),
  }
  return { createServiceRoleClient: () => ({ from: () => updateQuery }) }
})
vi.mock('@/lib/api-keys/verify', () => ({ verifyApiKey: verifyApiKeyMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))
vi.mock('@/lib/commerce/receipts', () => ({ insertCommerceReceipt: insertCommerceReceiptMock }))
vi.mock('@/lib/commerce/events', () => ({ emitCommerceEvent: emitCommerceEventMock }))

import { POST } from '@/app/api/v1/commerce/events/route'

const payload: CommerceEventPayload = {
  event_id: 'evt-1',
  type: 'order.placed',
  occurred_at: '2026-07-17T15:04:05.000Z',
  data: {
    order_id: 'order_1',
    display_id: 1001,
    email: 'jane@example.com',
    currency_code: 'usd',
    total: 49.99,
    cart_id: 'cart_1',
    items: [{ title: 'Widget', variant_id: 'variant_1', quantity: 2, unit_price: 24.995 }],
  },
}

function request(overrides?: {
  body?: unknown
  idempotencyKey?: string | null
  headers?: Record<string, string>
}) {
  const body = overrides && 'body' in overrides ? overrides.body : payload
  const headers: Record<string, string> = {
    authorization: 'Bearer xph_test',
    'content-type': 'application/json',
    ...overrides?.headers,
  }
  const idempotencyKey = overrides?.idempotencyKey !== undefined ? overrides.idempotencyKey : payload.event_id
  if (idempotencyKey !== null) headers['idempotency-key'] = idempotencyKey
  return new Request('https://xphere.app/api/v1/commerce/events', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/commerce/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyApiKeyMock.mockResolvedValue({
      ok: true,
      key: { keyId: 'key-1', orgId: 'org-1', scopes: ['commerce:events'] },
    })
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 599, resetAt: 0 })
  })

  it('201 on a new valid event, emit called once', async () => {
    insertCommerceReceiptMock.mockResolvedValue({ receiptId: 'rcpt-1', duplicate: false })

    const response = await POST(request())
    expect(response.status).toBe(201)
    const json = await response.json()
    expect(json).toEqual({ receipt_id: 'rcpt-1' })
    expect(emitCommerceEventMock).toHaveBeenCalledOnce()
    expect(emitCommerceEventMock).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'rcpt-1',
      'order.placed',
      payload.data,
    )
  })

  it('200 duplicate, emit NOT called', async () => {
    insertCommerceReceiptMock.mockResolvedValue({ duplicate: true })

    const response = await POST(request())
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toEqual({ duplicate: true })
    expect(emitCommerceEventMock).not.toHaveBeenCalled()
  })

  it('422 on invalid body', async () => {
    const response = await POST(
      request({ body: { event_id: 'evt-2', type: 'order.placed', occurred_at: payload.occurred_at, data: {} } }),
    )
    expect(response.status).toBe(422)
    expect(insertCommerceReceiptMock).not.toHaveBeenCalled()
    expect(emitCommerceEventMock).not.toHaveBeenCalled()
  })

  it('422 on Idempotency-Key mismatch', async () => {
    const response = await POST(request({ idempotencyKey: 'different' }))
    expect(response.status).toBe(422)
    expect(insertCommerceReceiptMock).not.toHaveBeenCalled()
    expect(emitCommerceEventMock).not.toHaveBeenCalled()
  })

  it('422 on missing Idempotency-Key', async () => {
    const response = await POST(request({ idempotencyKey: null }))
    expect(response.status).toBe(422)
    expect(insertCommerceReceiptMock).not.toHaveBeenCalled()
    expect(emitCommerceEventMock).not.toHaveBeenCalled()
  })
})

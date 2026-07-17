import { describe, expect, it } from 'vitest'
import { insertCommerceReceipt } from '@/lib/commerce/receipts'
import type { CommerceEventPayload } from '@/lib/commerce/ingestion-schema'

type Row = Record<string, unknown>

function createMemoryClient() {
  const receipts: Row[] = []
  let sequence = 0
  let forceError: { code: string } | null = null

  class Query {
    private operation: 'select' | 'insert' = 'select'
    private values: Row = {}

    constructor(private readonly table: string) {}
    select() { return this }
    insert(values: Row) { this.operation = 'insert'; this.values = values; return this }
    eq() { return this }

    async single() {
      if (this.operation !== 'insert') return { data: null, error: new Error('Unsupported operation') }
      if (forceError) return { data: null, error: forceError }
      const duplicate = receipts.find((item) =>
        item.org_id === this.values.org_id && item.event_id === this.values.event_id,
      )
      if (duplicate) return { data: null, error: { code: '23505' } }
      const row: Row = { id: `${this.table}-${++sequence}`, ...this.values }
      receipts.push(row)
      return { data: row, error: null }
    }
  }

  return {
    client: { from: (table: string) => new Query(table) },
    receipts,
    forceErrorOnce: (code: string) => { forceError = { code } },
  }
}

function orderPayload(eventId: string): CommerceEventPayload {
  return {
    event_id: eventId,
    type: 'order.placed',
    occurred_at: '2026-07-17T12:00:00Z',
    data: {
      order_id: 'order_01H...',
      display_id: 12,
      email: 'a@b.com',
      currency_code: 'eur',
      total: 123.45,
      cart_id: 'cart_01H...',
      items: [{ title: 'Sweatshirt', variant_id: 'variant_01H...', quantity: 1, unit_price: 35 }],
    },
  }
}

describe('insertCommerceReceipt', () => {
  it('returns a receiptId on the first insert, and marks a replay as a duplicate', async () => {
    const memory = createMemoryClient()
    const first = await insertCommerceReceipt(memory.client as never, 'org-a', orderPayload('evt-1'))
    const replay = await insertCommerceReceipt(memory.client as never, 'org-a', orderPayload('evt-1'))

    expect(first).toMatchObject({ duplicate: false })
    expect((first as { receiptId: string }).receiptId).toEqual(expect.any(String))
    expect(replay).toEqual({ duplicate: true })
    expect(memory.receipts).toHaveLength(1)
  })

  it('persists two different event_ids for the same org', async () => {
    const memory = createMemoryClient()
    const first = await insertCommerceReceipt(memory.client as never, 'org-a', orderPayload('evt-1'))
    const second = await insertCommerceReceipt(memory.client as never, 'org-a', orderPayload('evt-2'))

    expect(first).toMatchObject({ duplicate: false })
    expect(second).toMatchObject({ duplicate: false })
    expect(memory.receipts).toHaveLength(2)
  })

  it('isolates identical event_ids across orgs', async () => {
    const memory = createMemoryClient()
    const first = await insertCommerceReceipt(memory.client as never, 'org-a', orderPayload('evt-1'))
    const second = await insertCommerceReceipt(memory.client as never, 'org-b', orderPayload('evt-1'))

    expect(first).toMatchObject({ duplicate: false })
    expect(second).toMatchObject({ duplicate: false })
    expect(memory.receipts).toHaveLength(2)
  })

  it('rethrows a non-23505 error', async () => {
    const memory = createMemoryClient()
    memory.forceErrorOnce('42P01')
    await expect(insertCommerceReceipt(memory.client as never, 'org-a', orderPayload('evt-1'))).rejects.toBeTruthy()
  })
})

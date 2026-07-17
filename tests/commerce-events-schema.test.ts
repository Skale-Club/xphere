import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commerceEventSchema, type CommerceEventPayload } from '@/lib/commerce/ingestion-schema'

const validOrder: CommerceEventPayload = {
  event_id: 'evt_11111111-1111-1111-1111-111111111111',
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

const validCustomer: CommerceEventPayload = {
  event_id: 'evt_22222222-2222-2222-2222-222222222222',
  type: 'customer.created',
  occurred_at: '2026-07-17T12:00:00Z',
  data: {
    customer_id: 'cus_01H...',
    email: 'x@y.com',
    first_name: 'Jane',
    last_name: 'Doe',
  },
}

describe('commerceEventSchema', () => {
  it('accepts a valid order.placed envelope', () => {
    expect(commerceEventSchema.parse(validOrder)).toEqual(validOrder)
  })

  it('accepts a valid customer.created envelope', () => {
    expect(commerceEventSchema.parse(validCustomer)).toEqual(validCustomer)
  })

  it('preserves MAJOR units — never divided', () => {
    const parsed = commerceEventSchema.parse(validOrder)
    if (parsed.type !== 'order.placed') throw new Error('expected order.placed')
    expect(parsed.data.total).toBe(123.45)
    expect(parsed.data.items[0].unit_price).toBe(35)
  })

  it('rejects a stray top-level envelope field', () => {
    expect(() => commerceEventSchema.parse({ ...validOrder, org_id: 'attacker-org' })).toThrow()
  })

  it('rejects a wrong type', () => {
    expect(() => commerceEventSchema.parse({ ...validOrder, type: 'order.updated' })).toThrow()
  })

  it('rejects an absent type', () => {
    const { type: _type, ...withoutType } = validOrder
    expect(() => commerceEventSchema.parse(withoutType)).toThrow()
  })

  it('accepts a non-cart order.placed with cart_id null', () => {
    const withoutCart = { ...validOrder, data: { ...validOrder.data, cart_id: null } }
    expect(commerceEventSchema.parse(withoutCart)).toMatchObject({ data: { cart_id: null } })
  })

  it('migration 1260 is present with UNIQUE + RLS', () => {
    const sql = readFileSync('supabase/migrations/1260_commerce_event_receipts.sql', 'utf8')
    expect(sql).toContain('UNIQUE (org_id, event_id)')
    expect(sql).toContain('commerce_event_receipts_org_isolation')
  })
})

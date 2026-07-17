// MAJOR units — contract §5 v1.1; total/unit_price stored & forwarded verbatim,
// exactly as Medusa v2 returns them — never coerced or converted to minor units (cents).
import { z } from 'zod'

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

const orderData = z.object({
  order_id: z.string().trim().min(1).max(100),
  display_id: z.number().int(),
  email: z.string().trim().min(1).max(320), // loose, like leads — no .email()
  currency_code: z.string().trim().min(1).max(10),
  total: z.number(), // MAJOR units — no transform, verbatim from contract §5
  cart_id: z.string().trim().min(1).max(100).nullable(), // may be null for non-cart orders
  items: z.array(z.object({
    title: z.string().trim().max(500),
    variant_id: nullableText(100),
    quantity: z.number().int().min(0),
    unit_price: z.number(), // MAJOR units
  })).max(200),
}) // plain z.object → strips unknown inner keys (forward-compat)

const customerData = z.object({
  customer_id: z.string().trim().min(1).max(100),
  email: z.string().trim().min(1).max(320),
  first_name: nullableText(200),
  last_name: nullableText(200),
})

export const commerceEventSchema = z.discriminatedUnion('type', [
  z.object({
    event_id: z.string().trim().min(1).max(300),
    type: z.literal('order.placed'),
    occurred_at: z.string().datetime({ offset: true }),
    data: orderData,
  }).strict(),
  z.object({
    event_id: z.string().trim().min(1).max(300),
    type: z.literal('customer.created'),
    occurred_at: z.string().datetime({ offset: true }),
    data: customerData,
  }).strict(),
])

export type CommerceEventPayload = z.infer<typeof commerceEventSchema>

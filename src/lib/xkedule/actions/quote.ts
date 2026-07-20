// src/lib/xkedule/actions/quote.ts
// POST /api/v1/quote — price a cart WITHOUT creating a booking, so the agent
// can tell the customer a real total before asking them to confirm. Keeps
// the same agent-friendly "serviceId(s)" shape the other Xkedule tools use
// (quantity 1 each) rather than exposing the full options/frequency/area
// cart-item schema to the LLM.
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface QuoteParams {
  serviceId?: number | string
  serviceIds?: Array<number | string> | string
  [key: string]: unknown
}

interface QuoteItem {
  serviceId: number
  serviceName: string
  price: string
}

interface QuoteResponse {
  items: QuoteItem[]
  subtotal: string
  totalDurationMinutes: number
  requiresConfirmation: boolean
  currency: string
}

export async function getXkeduleQuote(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials,
): Promise<string> {
  const p = params as QuoteParams

  const ids = p.serviceIds
    ? Array.isArray(p.serviceIds)
      ? p.serviceIds
      : String(p.serviceIds).split(',')
    : p.serviceId != null
      ? [p.serviceId]
      : []
  if (ids.length === 0) {
    return 'Please provide serviceId(s) to quote.'
  }

  const items = ids
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((serviceId) => ({ serviceId, quantity: 1 }))

  if (items.length === 0) {
    return 'Please provide valid serviceId(s) to quote.'
  }

  try {
    const quote = await xkeduleFetchJson<QuoteResponse>('/api/v1/quote', 'POST', { items }, credentials)
    const lines = quote.items.map((i) => `${i.serviceName}: $${i.price}`).join('\n')
    const confirmNote = quote.requiresConfirmation ? ' (this booking will need owner confirmation)' : ''
    return `Quote:\n${lines}\nSubtotal: $${quote.subtotal} ${quote.currency.toUpperCase()}${confirmNote}`
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('422') || msg.includes('unknown_service')) {
      return 'One or more of those services could not be found.'
    }
    throw err
  }
}

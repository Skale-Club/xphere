// src/lib/medusa/actions/get-cart.ts
// Show the visitor's current cart. Takes NO input arguments at all — the
// cart identifier comes EXCLUSIVELY from the pinned
// conversations.memory.commerce.cart, never from caller-supplied data. This
// is the anti-IDOR core rule for this tool: since the function accepts only
// (creds, ctx), an attacker-controlled identifier has no channel into the
// call at all. See .planning/research/INTEGRATION-CONTRACT.md §3.

import { rateLimit } from '@/lib/rate-limit'
import { medusaStoreFetch, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { formatMoney } from '../format'

interface StoreCartItem {
  title: string
  quantity: number
  unit_price?: number
}

interface StoreCart {
  items?: StoreCartItem[]
  total?: number
  currency_code?: string
}

export async function getMedusaCart(creds: MedusaCredentials, ctx: MedusaExecCtx): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    const r6 = await rateLimit('com:read:' + sessionKey, 30, 60, { failMode: 'memory' })
    if (!r6.allowed) return "You've hit the store-lookup limit for a moment — try again shortly."

    const cartId = typeof commerce.cart === 'string' ? commerce.cart : undefined
    if (!cartId) {
      return "No cart is connected to this chat yet — add something on the store or ask me to add an item and I'll start one."
    }

    const { cart } = await medusaStoreFetch<{ cart: StoreCart }>(creds, `/store/carts/${cartId}`, ctx.organizationId)

    const currency = cart.currency_code
    const items = cart.items ?? []
    if (items.length === 0) return 'Your cart is empty.'

    const lines = items.map((item) => {
      const price = item.unit_price != null && currency ? ` (${formatMoney(item.unit_price, currency)} each)` : ''
      return `${item.title} x${item.quantity}${price}`
    })
    const totalStr = cart.total != null && currency ? `\nTotal: ${formatMoney(cart.total, currency)}` : ''

    return `Here's your cart:\n${lines.join('\n')}${totalStr}`
  } catch (err) {
    if (err instanceof MedusaRateLimitError) {
      return 'Too many store lookups just now — try again in a moment.'
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return 'The store took too long to respond.'
    }
    return "I couldn't reach the store just now."
  }
}

// src/lib/medusa/actions/get-order-status.ts
// Order status for the LOGGED-IN visitor only, via the privileged, HMAC-signed
// /agent/orders/status surface (contract §4.2). Owner comes EXCLUSIVELY from
// the pinned conversations.memory.commerce.cus — a guest is told to log in
// (no alternate-identifier lookup, no OTP; that's deferred UIX-04). Owner
// guard runs BEFORE R9 (5/24h, fail-closed) so guests never burn the budget.
// display_id preference is params.display_id > commerce.last_order_display_id
// (Phase 136) > omit (server returns the most recent order). Renders ONLY
// the contract §4.2 fields — the response type structurally excludes any
// delivery/payment-instrument details. Never throws: every expected failure
// resolves to a friendly string, mirroring wishlist-list.ts. See
// .planning/research/INTEGRATION-CONTRACT.md §4.2/§7 and 137-RESEARCH.md
// Pattern 3 / Pitfall 4.

import { rateLimit } from '@/lib/rate-limit'
import { medusaAgentFetch, MedusaApiError, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { formatMoney } from '../format'

interface OrderStatusResponse {
  order: {
    display_id: number
    status: string
    fulfillment_status: string
    payment_status: string
    total: number
    currency_code: string
    created_at: string
    items: { title: string; quantity: number }[]
  }
}

export async function getOrderStatus(
  params: Record<string, unknown>,
  creds: MedusaCredentials,
  ctx: MedusaExecCtx,
): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    // Owner guard FIRST (before R9) — no alternate-identifier lookup, no
    // throw, does NOT touch the rate limiter for guests (Pitfall 4).
    const cus = typeof commerce.cus === 'string' ? commerce.cus : undefined
    if (!cus) {
      return "Log in on the store and I'll be able to check your orders — I can't look those up for guests yet."
    }

    // R9 — order lookups / session / day, fail-CLOSED (contract §7).
    const r9 = await rateLimit('ord:read:' + sessionKey, 5, 86400, { failMode: 'closed' })
    if (!r9.allowed) return "You've checked orders a few times today — try again tomorrow."

    const displayId =
      typeof params.display_id === 'number'
        ? params.display_id
        : typeof commerce.last_order_display_id === 'number'
          ? commerce.last_order_display_id
          : undefined

    const body = { customer_id: cus, ...(displayId !== undefined ? { display_id: displayId } : {}) }

    const { order } = await medusaAgentFetch<OrderStatusResponse>(
      creds,
      '/agent/orders/status',
      ctx.organizationId,
      body,
    )

    const itemLines = (order.items ?? []).map((i) => `${i.title} x${i.quantity}`).join(', ')
    const total = formatMoney(order.total, order.currency_code)
    return `Order #${order.display_id}: ${order.status} — fulfillment ${order.fulfillment_status}, payment ${order.payment_status}. Total ${total}.${itemLines ? ` Items: ${itemLines}.` : ''}`
  } catch (err) {
    if (err instanceof MedusaApiError && err.status === 404) return "I couldn't find that order."
    if (err instanceof MedusaRateLimitError) return 'Too many store requests just now — try again in a moment.'
    if (err instanceof Error && err.name === 'TimeoutError') return 'The store took too long to respond.'
    return "I couldn't check your order status just now."
  }
}

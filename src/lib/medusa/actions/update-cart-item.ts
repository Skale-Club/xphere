// src/lib/medusa/actions/update-cart-item.ts
// Change the quantity of (or remove) a line item in the visitor's PINNED
// cart. The line is resolved by fuzzy title/variant match ONLY — tool
// params carry no cart_id/line_id (anti-IDOR core rule). quantity 0 issues
// a DELETE, which Medusa answers with `{ deleted, parent: cart }` — NOT
// `.cart` (134-RESEARCH.md Pitfall 3). Never throws into the tool loop.
// See .planning/research/INTEGRATION-CONTRACT.md §3/§4.1/§6/§7.

import { rateLimit } from '@/lib/rate-limit'
import { medusaStoreFetch, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { bumpConversationWriteCount } from '../context'
import { formatMoney } from '../format'

// Same write-response field query as add-to-cart.ts — guarantees items +
// totals + variant titles are present without a 2nd GET.
const CART_FIELDS = 'id,currency_code,+total,*items,+items.total,*items.variant'

interface StoreCartItem {
  id: string
  title: string
  quantity: number
  variant_id?: string
  variant?: { title?: string }
  total?: number
}

interface StoreCart {
  id: string
  currency_code?: string
  total?: number
  items?: StoreCartItem[]
}

function summarizeTotal(cart: StoreCart): string {
  return cart.total != null && cart.currency_code
    ? `Your cart total is ${formatMoney(cart.total, cart.currency_code)}.`
    : ''
}

function matchesQuery(item: StoreCartItem, query: string): boolean {
  const q = query.toLowerCase()
  return item.title.toLowerCase().includes(q) || (item.variant?.title?.toLowerCase().includes(q) ?? false)
}

export async function updateCartItemMedusa(
  params: Record<string, unknown>,
  creds: MedusaCredentials,
  ctx: MedusaExecCtx,
): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    // R7 — commerce writes / session, fail-CLOSED (contract §7).
    const r7 = await rateLimit('com:write:' + sessionKey, 10, 60, { failMode: 'closed' })
    if (!r7.allowed) return "You're changing the cart too fast — give it a moment."

    // R8 — commerce writes / conversation / day, fail-CLOSED (contract §7).
    const r8 = await rateLimit('com:write:day:' + (ctx.conversationId ?? sessionKey), 60, 86400, {
      failMode: 'closed',
    })
    if (!r8.allowed) return "You've reached today's cart-change limit for this chat."

    // 25-per-conversation guardrail cap (CRT-02).
    if (ctx.conversationId) {
      const budget = await bumpConversationWriteCount(ctx.supabase, ctx.conversationId, ctx.organizationId)
      if (!budget.allowed) return "You've reached today's cart-change limit for this chat."
    }

    const cartId = typeof commerce.cart === 'string' ? commerce.cart : undefined
    if (!cartId) {
      return "No cart is connected to this chat yet — add something on the store or ask me to add an item and I'll start one."
    }

    const query = typeof params.item_title_or_variant === 'string' ? params.item_title_or_variant : ''
    if (!query) return 'Tell me which item in your cart you want to change.'

    const { cart: currentCart } = await medusaStoreFetch<{ cart: StoreCart }>(
      creds,
      `/store/carts/${cartId}?fields=${encodeURIComponent(CART_FIELDS)}`,
      ctx.organizationId,
    )

    // Anti-IDOR: match by title/variant ONLY — never by a caller-supplied
    // line/cart id (there is none in params to begin with).
    const matches = (currentCart.items ?? []).filter((item) => matchesQuery(item, query))
    if (matches.length === 0) return "I couldn't find that item in your cart."
    if (matches.length > 1) {
      const titles = matches.map((m) => m.title).join(', ')
      return `I found a few matches — which one did you mean: ${titles}?`
    }

    const lineId = matches[0].id
    const q = Number(params.quantity)

    if (q === 0) {
      // DELETE returns { deleted, parent: cart } — NOT { cart } (Pitfall 3).
      // Read the removed-item cart state from .parent, never .cart.
      const deleteResponse = await medusaStoreFetch<{ deleted: boolean; parent: StoreCart }>(
        creds,
        `/store/carts/${cartId}/line-items/${lineId}`,
        ctx.organizationId,
        { method: 'DELETE' },
      )
      const itemCount = deleteResponse.parent.items?.length ?? 0
      ctx.emitStructured?.({ event: 'commerce', action: 'cart_updated', cartId, itemCount })
      return `Removed that from your cart. ${summarizeTotal(deleteResponse.parent)}`.trim()
    }

    const clampedQty = Math.max(1, Math.min(10, q || 1)) // clamp 1-10
    const { cart } = await medusaStoreFetch<{ cart: StoreCart }>(
      creds,
      `/store/carts/${cartId}/line-items/${lineId}?fields=${encodeURIComponent(CART_FIELDS)}`,
      ctx.organizationId,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: clampedQty }),
      },
    )
    const itemCount = cart.items?.length ?? 0
    ctx.emitStructured?.({ event: 'commerce', action: 'cart_updated', cartId, itemCount })
    return `Updated. ${summarizeTotal(cart)}`.trim()
  } catch (err) {
    if (err instanceof MedusaRateLimitError) return 'Too many store requests just now — try again in a moment.'
    if (err instanceof Error && err.name === 'TimeoutError') return 'The store took too long to respond.'
    return "I couldn't update your cart just now."
  }
}

// src/lib/medusa/actions/wishlist-add.ts
// Save a product to the visitor's wishlist via the privileged, HMAC-signed
// /agent/wishlists/add surface (contract §4.2). Owner comes EXCLUSIVELY from
// the pinned conversations.memory.commerce (resolveWishlistOwner) — NO owner
// param is ever read from `params`. Mirrors add-to-cart.ts's shape (R7/R8
// fail-closed, never throw into the tool loop) but without any
// region/variant-resolution/cart-bootstrap, since wishlist add is a single
// signed POST. See .planning/research/INTEGRATION-CONTRACT.md §4.2/§7 and
// 135-RESEARCH.md Pattern 2/Pitfall 5.

import { rateLimit } from '@/lib/rate-limit'
import { medusaAgentFetch, MedusaApiError, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { resolveWishlistOwner } from '../wishlist-owner'

interface WishlistAddResponse {
  item: {
    product_id?: string
    variant_id?: string | null
    product?: { title?: string; handle?: string; thumbnail?: string } | null
  }
}

export async function addWishlistItem(
  params: Record<string, unknown>,
  creds: MedusaCredentials,
  ctx: MedusaExecCtx,
): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    const owner = resolveWishlistOwner(commerce)
    if (!owner) {
      return "Nothing's saved to a wishlist yet — browse the store or ask me to save an item and I'll start one for you."
    }

    // R7 — commerce writes / session, fail-CLOSED (contract §7). SAME shared
    // key as cart writes — wishlist and cart writes draw from one budget.
    const r7 = await rateLimit('com:write:' + sessionKey, 10, 60, { failMode: 'closed' })
    if (!r7.allowed) return "You're saving items too fast — give it a moment."

    // R8 — commerce writes / conversation / day, fail-CLOSED (contract §7).
    const r8 = await rateLimit('com:write:day:' + (ctx.conversationId ?? sessionKey), 60, 86400, {
      failMode: 'closed',
    })
    if (!r8.allowed) return "You've reached today's save limit for this chat."

    const productId = typeof params.product_id === 'string' ? params.product_id : undefined
    if (!productId) return 'Tell me which product (name or link) you want to save.'
    const variantId = typeof params.variant_id === 'string' ? params.variant_id : undefined

    const { item } = await medusaAgentFetch<WishlistAddResponse>(
      creds,
      '/agent/wishlists/add',
      ctx.organizationId,
      { ...owner, product_id: productId, ...(variantId ? { variant_id: variantId } : {}) },
    )

    const title = item.product?.title ?? 'that item'
    return `Saved ${title} to your wishlist.` // idempotent-safe wording — stuscle cannot distinguish already-saved vs newly-saved
  } catch (err) {
    if (err instanceof MedusaApiError && err.status === 409) {
      return "Your wishlist is full (100 items max) — I couldn't save that one."
    }
    if (err instanceof MedusaRateLimitError) return 'Too many store requests just now — try again in a moment.'
    if (err instanceof Error && err.name === 'TimeoutError') return 'The store took too long to respond.'
    return "I couldn't save that to your wishlist just now." // also covers 401 (config/clock, not a user problem)
  }
}

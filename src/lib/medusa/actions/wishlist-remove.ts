// src/lib/medusa/actions/wishlist-remove.ts
// Remove a product from the visitor's wishlist via the privileged,
// HMAC-signed /agent/wishlists/remove surface (contract §4.2). Identical
// scaffold to wishlist-add.ts: owner comes EXCLUSIVELY from the pinned
// conversations.memory.commerce (resolveWishlistOwner) — NO owner param is
// ever read from `params`. Stuscle returns `{ removed: true }` even when
// nothing matched (idempotent) — no 409 branch needed here (remove has no
// wishlist_full). See .planning/research/INTEGRATION-CONTRACT.md §4.2/§7 and
// 135-RESEARCH.md Pattern 2/Pitfall 5.

import { rateLimit } from '@/lib/rate-limit'
import { medusaAgentFetch, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { resolveWishlistOwner } from '../wishlist-owner'

interface WishlistRemoveResponse {
  removed: boolean
}

export async function removeWishlistItem(
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
    if (!r7.allowed) return "You're changing your wishlist too fast — give it a moment."

    // R8 — commerce writes / conversation / day, fail-CLOSED (contract §7).
    const r8 = await rateLimit('com:write:day:' + (ctx.conversationId ?? sessionKey), 60, 86400, {
      failMode: 'closed',
    })
    if (!r8.allowed) return "You've reached today's save limit for this chat."

    const productId = typeof params.product_id === 'string' ? params.product_id : undefined
    if (!productId) return 'Tell me which product (name or link) you want to remove.'
    const variantId = typeof params.variant_id === 'string' ? params.variant_id : undefined

    await medusaAgentFetch<WishlistRemoveResponse>(creds, '/agent/wishlists/remove', ctx.organizationId, {
      ...owner,
      product_id: productId,
      ...(variantId ? { variant_id: variantId } : {}),
    })

    return 'Removed that from your wishlist.' // idempotent-safe wording — stuscle returns removed:true even when nothing matched
  } catch (err) {
    if (err instanceof MedusaRateLimitError) return 'Too many store requests just now — try again in a moment.'
    if (err instanceof Error && err.name === 'TimeoutError') return 'The store took too long to respond.'
    return "I couldn't update your wishlist just now." // also covers 401 (config/clock, not a user problem)
  }
}

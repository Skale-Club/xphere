// src/lib/medusa/actions/wishlist-list.ts
// Show the visitor's wishlist via the privileged, HMAC-signed
// /agent/wishlists/list surface (contract §4.2). Takes NO input arguments at
// all — mirrors get-cart.ts's (creds, ctx) signature: since the function
// accepts no params, an attacker-controlled identifier has no channel into
// the call at all (anti-IDOR structural guarantee). Owner comes EXCLUSIVELY
// from the pinned conversations.memory.commerce (resolveWishlistOwner). See
// .planning/research/INTEGRATION-CONTRACT.md §4.2/§7 and 135-RESEARCH.md
// Pattern 2/3.

import { rateLimit } from '@/lib/rate-limit'
import { medusaAgentFetch, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { resolveWishlistOwner } from '../wishlist-owner'

interface WishlistItem {
  product_id: string
  variant_id?: string | null
  product?: { title?: string; handle?: string; thumbnail?: string } | null
}

interface WishlistListResponse {
  wishlist: {
    items: WishlistItem[]
  }
}

export async function listWishlist(creds: MedusaCredentials, ctx: MedusaExecCtx): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    const owner = resolveWishlistOwner(commerce)
    if (!owner) {
      return "Nothing's saved to a wishlist yet — browse the store or ask me to save an item and I'll start one for you."
    }

    // R6 — commerce reads / session, fail-open to per-instance memory (contract §7).
    const r6 = await rateLimit('com:read:' + sessionKey, 30, 60, { failMode: 'memory' })
    if (!r6.allowed) return "You've hit the store-lookup limit for a moment — try again shortly."

    const { wishlist } = await medusaAgentFetch<WishlistListResponse>(
      creds,
      '/agent/wishlists/list',
      ctx.organizationId,
      owner,
    )

    const items = wishlist.items ?? []
    if (items.length === 0) return 'Your wishlist is empty.'

    const lines = items.map((i) => i.product?.title ?? i.product_id)
    return `Your wishlist:\n${lines.join('\n')}`
  } catch (err) {
    if (err instanceof MedusaRateLimitError) return 'Too many store lookups just now — try again in a moment.'
    if (err instanceof Error && err.name === 'TimeoutError') return 'The store took too long to respond.'
    return "I couldn't reach the store just now."
  }
}

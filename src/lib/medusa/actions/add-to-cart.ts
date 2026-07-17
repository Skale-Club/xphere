// src/lib/medusa/actions/add-to-cart.ts
// Add an item to the visitor's PINNED cart — creating one (region-scoped) if
// none exists yet. On create, this executor is the ONLY place that mints the
// cart adoption sig (contract §3/§6): create -> sign -> write metadata ->
// pin -> emit `cart_created` (in that exact order — see 134-RESEARCH.md
// Pitfall 2) -> THEN add the line item -> emit `cart_updated`. Tool params
// carry ONLY product_id/variant_id/quantity — never a cart id (anti-IDOR
// core rule: cart identity comes exclusively from the pinned
// conversations.memory.commerce.cart). Never throws into the tool loop —
// every expected failure resolves to a friendly string, mirroring
// get-cart.ts. See .planning/research/INTEGRATION-CONTRACT.md §3/§4.1/§6/§7.

import { rateLimit } from '@/lib/rate-limit'
import { medusaStoreFetch, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { pinCartId, bumpConversationWriteCount } from '../context'
import { signCartSig } from '../cart-sig'
import { resolveRegionId } from '../regions'
import { formatMoney } from '../format'

// Requested on the add/update write calls so `items` (id, variant_id, title,
// quantity, total) + totals are present in the response without a 2nd GET —
// Medusa's write endpoints already return the FULL computed cart.
const CART_FIELDS = 'id,currency_code,+total,*items,+items.total,*items.variant'

interface StoreCartItem {
  id: string
  title: string
  quantity: number
  variant_id?: string
  total?: number
}

interface StoreCart {
  id: string
  currency_code?: string
  total?: number
  items?: StoreCartItem[]
}

interface StoreProductVariant {
  id: string
  title?: string
}

interface StoreProduct {
  id: string
  title: string
  variants?: StoreProductVariant[]
}

function summarizeTotal(cart: StoreCart): string {
  return cart.total != null && cart.currency_code
    ? `Your cart total is ${formatMoney(cart.total, cart.currency_code)}.`
    : ''
}

type VariantResolution = { ok: true; variantId: string } | { ok: false; message: string }

// product_id/variant_id ARE allowed in tool params (only visitor-scoped ids
// — cart_id/customer_id/email — are banned). variant_id wins outright; a
// product_id with exactly one variant auto-selects it; a product_id with
// multiple variants returns an option-picker STRING (no store write).
async function resolveVariant(
  params: Record<string, unknown>,
  creds: MedusaCredentials,
  ctx: MedusaExecCtx,
): Promise<VariantResolution> {
  if (typeof params.variant_id === 'string' && params.variant_id) {
    return { ok: true, variantId: params.variant_id }
  }

  const productId = typeof params.product_id === 'string' ? params.product_id : undefined
  if (!productId) return { ok: false, message: 'Tell me which product (name or link) you want to add.' }

  const { product } = await medusaStoreFetch<{ product?: StoreProduct }>(
    creds,
    `/store/products/${productId}?fields=id,title,*variants`,
    ctx.organizationId,
  )
  if (!product) return { ok: false, message: "I couldn't find that product." }

  const variants = product.variants ?? []
  if (variants.length === 0) return { ok: false, message: "That product doesn't have any purchasable options." }
  if (variants.length === 1) return { ok: true, variantId: variants[0].id }

  const options = variants.map((v) => v.title ?? v.id).join(', ')
  return { ok: false, message: `Which option would you like: ${options}?` }
}

export async function addToCartMedusa(
  params: Record<string, unknown>,
  creds: MedusaCredentials,
  ctx: MedusaExecCtx,
): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    // R7 — commerce writes / session, fail-CLOSED (contract §7).
    const r7 = await rateLimit('com:write:' + sessionKey, 10, 60, { failMode: 'closed' })
    if (!r7.allowed) return "You're adding to the cart too fast — give it a moment."

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

    const qty = Math.max(1, Math.min(10, Number(params.quantity) || 1)) // clamp 1-10

    let cartId = typeof commerce.cart === 'string' ? commerce.cart : undefined
    if (!cartId) {
      const regionId =
        typeof commerce.region_id === 'string'
          ? commerce.region_id
          : await resolveRegionId(
              creds,
              ctx.organizationId,
              typeof commerce.country_code === 'string' ? commerce.country_code : undefined,
            )

      // 1) create
      const { cart: createdCart } = await medusaStoreFetch<{ cart: { id: string } }>(
        creds,
        '/store/carts',
        ctx.organizationId,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ region_id: regionId }),
        },
      )
      cartId = createdCart.id

      // 2) sign + write metadata — MUST resolve 2xx before we ever emit
      // (134-RESEARCH.md Pitfall 2: emitting before this races the
      // storefront's adoption fetch).
      const sig = await signCartSig(creds.connectionToken, cartId)
      await medusaStoreFetch(creds, `/store/carts/${cartId}`, ctx.organizationId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { xphere_sig: sig } }),
      })

      // 3) pin (cart-only merge — preserves region_id/cus/email/wishlist_ref).
      if (ctx.conversationId) {
        await pinCartId(ctx.supabase, ctx.conversationId, ctx.organizationId, cartId)
      }

      // 4) emit cart_created ONLY now — order is load-bearing.
      ctx.emitStructured?.({ event: 'commerce', action: 'cart_created', cartId, itemCount: 0, sig })
    }

    const resolved = await resolveVariant(params, creds, ctx)
    if (!resolved.ok) return resolved.message
    const variantId = resolved.variantId

    // 5) add line item — response is the FULL cart with items.
    const { cart } = await medusaStoreFetch<{ cart: StoreCart }>(
      creds,
      `/store/carts/${cartId}/line-items?fields=${encodeURIComponent(CART_FIELDS)}`,
      ctx.organizationId,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant_id: variantId, quantity: qty }),
      },
    )

    // 6) <=50 rollback — Medusa merges same-variant adds into one line, so a
    // brand-new distinct-variant line is the only way the count crosses 50,
    // and that line is always safe to delete wholesale (Pitfall 6).
    if ((cart.items?.length ?? 0) > 50) {
      const newLine = cart.items?.find((i) => i.variant_id === variantId)
      if (newLine) {
        await medusaStoreFetch(creds, `/store/carts/${cartId}/line-items/${newLine.id}`, ctx.organizationId, {
          method: 'DELETE',
        })
      }
      return "Your cart is full (50 items max) — I couldn't add that one."
    }

    ctx.emitStructured?.({ event: 'commerce', action: 'cart_updated', cartId, itemCount: cart.items?.length ?? 0 })
    return `Added ${qty} to your cart. ${summarizeTotal(cart)}`.trim()
  } catch (err) {
    if (err instanceof MedusaRateLimitError) return 'Too many store requests just now — try again in a moment.'
    if (err instanceof Error && err.name === 'TimeoutError') return 'The store took too long to respond.'
    return "I couldn't update your cart just now."
  }
}

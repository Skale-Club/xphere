// src/lib/medusa/actions/get-product.ts
// One store product's detail by id OR handle. Product ids are allowed in the
// schema (only VISITOR-scoped ids — cart_id/customer_id/email — are banned
// per the anti-IDOR rule). Never throws: friendly strings on every expected
// failure. See .planning/research/INTEGRATION-CONTRACT.md §4.1.

import { rateLimit } from '@/lib/rate-limit'
import { medusaStoreFetch, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { resolveRegionId } from '../regions'
import { formatMoney } from '../format'

const PRODUCT_FIELDS = 'id,title,handle,thumbnail,description,*variants.calculated_price,*variants.options'

interface StoreProductVariant {
  calculated_price?: { calculated_amount?: number; currency_code?: string }
}

interface StoreProduct {
  id: string
  title: string
  handle?: string
  description?: string | null
  variants?: StoreProductVariant[]
}

function formatProduct(p: StoreProduct): string {
  const variant = p.variants?.[0]
  const price = variant?.calculated_price
  const priceStr =
    price?.calculated_amount != null && price.currency_code
      ? ` — ${formatMoney(price.calculated_amount, price.currency_code)}`
      : ''
  const desc = p.description ? `\n${p.description}` : ''
  return `${p.title}${priceStr}${desc}`
}

export async function getMedusaProduct(
  params: Record<string, unknown>,
  creds: MedusaCredentials,
  ctx: MedusaExecCtx,
): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    const r6 = await rateLimit('com:read:' + sessionKey, 30, 60, { failMode: 'memory' })
    if (!r6.allowed) return "You've hit the store-lookup limit for a moment — try again shortly."

    const productId = typeof params.product_id === 'string' ? params.product_id : undefined
    const handle = typeof params.handle === 'string' ? params.handle : undefined
    if (!productId && !handle) return 'Tell me the product name or link.'

    const regionId =
      typeof commerce.region_id === 'string'
        ? commerce.region_id
        : await resolveRegionId(
            creds,
            ctx.organizationId,
            typeof commerce.country_code === 'string' ? commerce.country_code : undefined,
          )

    if (productId) {
      const qs = new URLSearchParams()
      qs.set('fields', PRODUCT_FIELDS)
      if (regionId) qs.set('region_id', regionId)
      const { product } = await medusaStoreFetch<{ product?: StoreProduct }>(
        creds,
        `/store/products/${productId}?${qs.toString()}`,
        ctx.organizationId,
      )
      if (!product) return "I couldn't find that product."
      return formatProduct(product)
    }

    const qs = new URLSearchParams()
    qs.set('handle', handle as string)
    qs.set('fields', PRODUCT_FIELDS)
    if (regionId) qs.set('region_id', regionId)
    const { products } = await medusaStoreFetch<{ products: StoreProduct[] }>(
      creds,
      `/store/products?${qs.toString()}`,
      ctx.organizationId,
    )
    if (!products || products.length === 0) return "I couldn't find that product."
    return formatProduct(products[0])
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

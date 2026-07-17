// src/lib/medusa/actions/get-product.ts
// One store product's detail by id OR handle. Product ids are allowed in the
// schema (only VISITOR-scoped ids — cart_id/customer_id/email — are banned
// per the anti-IDOR rule). Never throws: friendly strings on every expected
// failure. See .planning/research/INTEGRATION-CONTRACT.md §4.1.

import { rateLimit } from '@/lib/rate-limit'
import { medusaStoreFetch, MedusaRateLimitError, type MedusaCredentials, type MedusaExecCtx } from '../client'
import { loadPinnedContext } from '../pinned-context'
import { resolveRegion } from '../regions'
import { formatMoney } from '../format'

const PRODUCT_FIELDS = 'id,title,handle,thumbnail,description,*variants.calculated_price,*variants.options'

interface StoreProductVariant {
  id?: string
  calculated_price?: { calculated_amount?: number; currency_code?: string }
}

interface StoreProduct {
  id: string
  title: string
  handle?: string
  thumbnail?: string | null
  description?: string | null
  variants?: StoreProductVariant[]
}

// Contract §6 `ui`/`product_cards` card builder — mirrors search-products.ts's
// buildCardItem exactly (kept as a sibling copy rather than a shared import so
// each executor stays a self-contained, independently-testable file, matching
// the existing PRODUCT_FIELDS/formatProduct duplication in this pair). `url`
// is ONLY set when a country is known — never emit a broken `//products/...`
// link (137 Pitfall 2).
function buildCardItem(
  p: StoreProduct,
  countryCode: string | undefined,
  storefrontUrl: string | undefined,
): Record<string, unknown> {
  const variant = p.variants?.[0]
  const price = variant?.calculated_price
  const item: Record<string, unknown> = {
    id: p.id,
    variantId: variant?.id,
    title: p.title,
    thumbnail: p.thumbnail ?? null,
    price:
      price?.calculated_amount != null && price.currency_code
        ? formatMoney(price.calculated_amount, price.currency_code)
        : undefined,
    handle: p.handle,
  }
  if (countryCode && p.handle) item.url = `${storefrontUrl ?? ''}/${countryCode}/products/${p.handle}`
  return item
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

    const pinnedCountry = typeof commerce.country_code === 'string' ? commerce.country_code : undefined
    let regionId = typeof commerce.region_id === 'string' ? commerce.region_id : undefined
    let countryCode = pinnedCountry
    if (!regionId) {
      const resolved = await resolveRegion(creds, ctx.organizationId, pinnedCountry)
      regionId = resolved.id
      countryCode = countryCode ?? resolved.countryCode
    }

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
      if (ctx.emitStructured) {
        ctx.emitStructured({
          event: 'ui',
          component: 'product_cards',
          items: [buildCardItem(product, countryCode, creds.storefrontUrl)],
        })
      }
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
    if (ctx.emitStructured) {
      ctx.emitStructured({
        event: 'ui',
        component: 'product_cards',
        items: [buildCardItem(products[0], countryCode, creds.storefrontUrl)],
      })
    }
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

// src/lib/medusa/actions/search-products.ts
// GET /store/products?q=&region_id=&limit=5&fields=... — concise NL listing
// of up to 5 region-priced products. Never throws: every expected failure
// (R6 breach, timeout, non-2xx) returns a friendly string. See
// .planning/research/INTEGRATION-CONTRACT.md §4.1 and 132-RESEARCH.md.

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
  variants?: StoreProductVariant[]
}

// Contract §6 `ui`/`product_cards` card builder — shared by search-products.ts
// and get-product.ts. `url` is ONLY set when a country is known (pinned or
// region-resolved) — never emit a broken `//products/...` link (137 Pitfall 2).
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

export async function searchMedusaProducts(
  params: Record<string, unknown>,
  creds: MedusaCredentials,
  ctx: MedusaExecCtx,
): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    const r6 = await rateLimit('com:read:' + sessionKey, 30, 60, { failMode: 'memory' })
    if (!r6.allowed) return "You've hit the store-lookup limit for a moment — try again shortly."

    const query =
      typeof params.query === 'string' ? params.query : typeof params.category === 'string' ? params.category : ''

    const pinnedCountry = typeof commerce.country_code === 'string' ? commerce.country_code : undefined
    let regionId = typeof commerce.region_id === 'string' ? commerce.region_id : undefined
    let countryCode = pinnedCountry
    if (!regionId) {
      const resolved = await resolveRegion(creds, ctx.organizationId, pinnedCountry)
      regionId = resolved.id
      countryCode = countryCode ?? resolved.countryCode
    }

    const qs = new URLSearchParams()
    qs.set('limit', '5')
    qs.set('fields', PRODUCT_FIELDS)
    if (query) qs.set('q', query)
    if (regionId) qs.set('region_id', regionId)

    const { products } = await medusaStoreFetch<{ products: StoreProduct[] }>(
      creds,
      `/store/products?${qs.toString()}`,
      ctx.organizationId,
    )

    if (!products || products.length === 0) return 'No products found.'

    if (ctx.emitStructured) {
      const items = products.slice(0, 5).map((p) => buildCardItem(p, countryCode, creds.storefrontUrl))
      ctx.emitStructured({ event: 'ui', component: 'product_cards', items })
    }

    const lines = products.slice(0, 5).map((p) => {
      const variant = p.variants?.[0]
      const price = variant?.calculated_price
      const priceStr =
        price?.calculated_amount != null && price.currency_code
          ? ` — ${formatMoney(price.calculated_amount, price.currency_code)}`
          : ''
      return `${p.title}${priceStr}`
    })

    return `Here's what I found:\n${lines.join('\n')}`
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

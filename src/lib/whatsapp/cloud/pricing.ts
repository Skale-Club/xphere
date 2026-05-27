/**
 * Approximate Meta WhatsApp Cloud API pricing per delivered message.
 *
 * Numbers are static defaults updated periodically. Real billing comes from
 * Meta — this is only an in-app estimate so users can see per-campaign cost.
 * Returns USD; conversion to local currency happens at display time.
 *
 * Source (as of 2026-05-27, may need refresh):
 *   https://developers.facebook.com/docs/whatsapp/pricing/
 */

type Category = 'marketing' | 'utility' | 'authentication' | 'service'

// Per-message in USD by category + country (ISO2 lowercase). 'default'
// fallback covers regions we haven't tabulated yet.
const PRICE_TABLE: Record<Category, Record<string, number>> = {
  marketing: {
    br: 0.0625,
    us: 0.025,
    in: 0.0125,
    mx: 0.0436,
    default: 0.05,
  },
  utility: {
    br: 0.008,
    us: 0.015,
    in: 0.0027,
    mx: 0.0436,
    default: 0.012,
  },
  authentication: {
    br: 0.0315,
    us: 0.0135,
    in: 0.0014,
    mx: 0.0298,
    default: 0.020,
  },
  // Service messages (within 24h conversation): free since Nov/2024
  service: { default: 0 },
}

export function estimateCost(category: Category, countryIso2: string | null | undefined): number {
  const code = (countryIso2 ?? '').toLowerCase()
  const table = PRICE_TABLE[category]
  return table[code] ?? table.default
}

/** Map Meta template category (UPPERCASE) to our cost categories. */
export function templateCategoryToCost(metaCategory: string): Category {
  const c = metaCategory.toUpperCase()
  if (c === 'MARKETING') return 'marketing'
  if (c === 'UTILITY') return 'utility'
  if (c === 'AUTHENTICATION') return 'authentication'
  return 'service'
}

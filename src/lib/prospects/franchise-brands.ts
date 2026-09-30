// src/lib/prospects/franchise-brands.ts
//
// Item 3(b), 2026-09-30: prospects_import_to_xmail retains national
// barbershop/salon franchise locations for a human decision instead of
// importing them as independent local businesses. Why: the outreach
// campaign copy pitches "independent barbershops" — mailing a franchise HQ
// or corporate-owned location is the wrong target, and (per Item 3's
// production evidence) it is also where a shared support inbox is most
// likely to live, e.g. contact.us@sportclips.com showing up on a scraped
// Sport Clips location — that address is the corporate support mailbox for
// the whole national chain, not that unit's own.
//
// Recognized by EITHER the business name (a token match, so "Sport Clips
// Haircuts of Anytown" still matches "sport clips") OR the domain of the
// prospect's email/website (its corporate site or a shared support inbox).
// Kept as exactly one commented list/module per the task requirement, so a
// second copy never drifts out of sync with this one.
//
// Minimum required roster (confirm each name against the source list before
// removing any): Sport Clips, Great Clips, Supercuts, Fantastic Sam's, Cost
// Cutters, Floyd's 99, Hair Cuttery, Roosters Men's Grooming, V's
// Barbershop, 18|8 Fine Men's Salons, The Lodge (Hair), Regis.

export interface FranchiseBrand {
  /** Display name used in retained/reported output. */
  name: string
  /** Case-insensitive substring tokens matched against the business name. */
  nameTokens: string[]
  /** Domains used by the brand's corporate site or a known shared/support inbox. */
  domains: string[]
}

export const FRANCHISE_BRANDS: FranchiseBrand[] = [
  { name: 'Sport Clips', nameTokens: ['sport clips'], domains: ['sportclips.com'] },
  { name: 'Great Clips', nameTokens: ['great clips'], domains: ['greatclips.com'] },
  { name: 'Supercuts', nameTokens: ['supercuts'], domains: ['supercuts.com'] },
  { name: "Fantastic Sam's", nameTokens: ['fantastic sam'], domains: ['fantasticsams.com'] },
  { name: 'Cost Cutters', nameTokens: ['cost cutters', 'costcutters'], domains: ['costcutters.com'] },
  // "Floyd's 99 Barbershop" — apostrophe is stripped (not spaced) before
  // matching, so the token below is written the same way, e.g. "floyds 99".
  { name: "Floyd's 99 Barbershop", nameTokens: ['floyds 99'], domains: ['floyds99.com'] },
  { name: 'Hair Cuttery', nameTokens: ['hair cuttery'], domains: ['haircuttery.com'] },
  { name: "Roosters Men's Grooming Center", nameTokens: ['roosters'], domains: ['roostersmgc.com', 'roostersmensgrooming.com'] },
  { name: "V's Barbershop", nameTokens: ['vs barbershop'], domains: ['vsbarbershop.com'] },
  { name: "18|8 Fine Men's Salons", nameTokens: ['18 8 fine mens salons', '18|8'], domains: ['1888barbershop.com', '188finemenssalons.com'] },
  { name: 'The Lodge (Hair)', nameTokens: ['the lodge hair', 'the lodge barbershop'], domains: ['thelodgebarbershop.com', 'thelodgehair.com'] },
  { name: 'Regis', nameTokens: ['regis salon', 'regis hairstylist'], domains: ['regissalons.com', 'regiscorp.com'] },
]

/** Lowercases and strips punctuation, so variants (apostrophes, pipes,
 *  hyphens, parentheses) never cause a token match to miss. Apostrophes are
 *  removed outright (not turned into a space) so "Floyd's" -> "floyds" stays
 *  one word — turning it into "floyd s" would split it in two and break a
 *  plain "floyds 99" substring match. Every other non-alphanumeric run
 *  becomes a single space. Applied identically to both the candidate name
 *  and each brand token, so a token is always written the same way a real
 *  business name would normalize. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function extractDomain(value: string | null): string | null {
  if (!value) return null
  const withoutProtocol = value.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  const atIndex = withoutProtocol.indexOf('@')
  const hostPart = atIndex >= 0 ? withoutProtocol.slice(atIndex + 1) : withoutProtocol
  const domain = hostPart.split(/[/?#]/)[0]?.trim().toLowerCase()
  return domain || null
}

/**
 * Returns the matched brand's display name, or null when this business does
 * not look like a recognized franchise location. Company prospects only —
 * callers should not run this against person-kind contacts.
 */
export function matchesFranchiseBrand(
  name: string | null,
  email: string | null,
  website: string | null,
): string | null {
  const normalizedName = name ? normalize(name) : ''
  const emailDomain = extractDomain(email)
  const siteDomain = extractDomain(website)
  for (const brand of FRANCHISE_BRANDS) {
    if (normalizedName && brand.nameTokens.some((token) => normalizedName.includes(normalize(token)))) {
      return brand.name
    }
    if (emailDomain && brand.domains.includes(emailDomain)) return brand.name
    if (siteDomain && brand.domains.includes(siteDomain)) return brand.name
  }
  return null
}

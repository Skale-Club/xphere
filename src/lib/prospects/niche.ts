/**
 * Prospecting niche: the business segment a scrape targets ("barbershop", "nail_salon").
 *
 * Xcraper sends it on every prospect of a scrape (`custom_fields.niche`); Xphere keeps the full
 * set a business belongs to in `custom_fields.niches` and builds one Meta audience per niche, so
 * ads for barbershops never reach nail salons. The slug rule is shared with Xcraper
 * (backend/src/utils/niche.ts): keep the two in sync.
 */

export const NICHE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
export const NICHE_MIN_LENGTH = 2
export const NICHE_MAX_LENGTH = 40

export const NICHE_FORMAT_MESSAGE =
  'niche must be a lowercase slug (a-z, 0-9, words joined by "_"), 2-40 characters, singular English, e.g. "barbershop" or "nail_salon"'

export function isValidNiche(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= NICHE_MIN_LENGTH
    && value.length <= NICHE_MAX_LENGTH
    && NICHE_PATTERN.test(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Every valid niche a `custom_fields` blob carries: the `niches` array plus the single `niche`
 * (rows written before `niches` existed, or a payload that only sent `niche`). De-duplicated, in
 * first-seen order; anything that is not a valid slug is ignored.
 */
export function nichesFromCustomFields(customFields: unknown): string[] {
  const record = asRecord(customFields)
  const out: string[] = []
  const push = (value: unknown) => {
    if (isValidNiche(value) && !out.includes(value)) out.push(value)
  }
  if (Array.isArray(record.niches)) record.niches.forEach(push)
  push(record.niche)
  return out
}

/**
 * Niche bookkeeping for a prospect write. `customFields` is the blob about to be stored (already
 * merged with the existing one on an update); `existingCustomFields` is what the row held before
 * (undefined on insert) and `incomingCustomFields` is the payload as received. Returns it with:
 *  - `niches` = union(existing niches, incoming niches), never dropping one that was there;
 *  - `niche`  = the incoming niche when it is valid (latest scrape), else the existing one;
 *  - an invalid incoming `niche` removed, so a typo cannot linger as a pseudo-niche.
 * With no niche anywhere the blob is returned untouched (no empty `niches` key is invented).
 */
export function withMergedNiches(
  customFields: Record<string, unknown>,
  existingCustomFields: unknown,
  incomingCustomFields: unknown,
): Record<string, unknown> {
  const incoming = asRecord(incomingCustomFields)
  const existingNiches = nichesFromCustomFields(existingCustomFields)
  const incomingNiches = nichesFromCustomFields(incoming)
  const union = [...existingNiches]
  for (const niche of incomingNiches) if (!union.includes(niche)) union.push(niche)

  const next = { ...customFields }
  if (Object.prototype.hasOwnProperty.call(incoming, 'niche') && !isValidNiche(incoming.niche)) {
    delete next.niche
  }
  if (union.length === 0) {
    delete next.niches
    return next
  }

  next.niches = union
  if (isValidNiche(incoming.niche)) next.niche = incoming.niche
  else if (isValidNiche(asRecord(existingCustomFields).niche)) next.niche = asRecord(existingCustomFields).niche
  else next.niche = union[0]
  return next
}

/** "nail_salon" -> "Nail Salons": the display name a niche audience gets by default. */
export function nicheAudienceTitle(niche: string): string {
  const words = niche.split('_').filter(Boolean)
  if (words.length === 0) return niche
  const last = words[words.length - 1]
  let plural = last
  if (!last.endsWith('s')) {
    if (/[^aeiou]y$/.test(last)) plural = `${last.slice(0, -1)}ies`
    else if (/(sh|ch|x|z)$/.test(last)) plural = `${last}es`
    else plural = `${last}s`
  }
  return [...words.slice(0, -1), plural].map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

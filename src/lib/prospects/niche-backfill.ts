import { isValidNiche, nichesFromCustomFields } from '@/lib/prospects/niche'

/**
 * Pure helpers behind scripts/backfill-prospect-niche.ts: they decide which niche an old
 * Xcraper prospect belongs to from the query of the scrape that found it. Kept apart from the
 * script (which talks to the database) so the decisions can be tested without one.
 */

export interface NicheRule {
  niche: string
  pattern: RegExp
}

/** Built-in rule: a query mentioning barber / barbershop / barbearia is the barbershop niche. */
export const DEFAULT_NICHE_RULES: readonly NicheRule[] = [
  { niche: 'barbershop', pattern: /barber|barbearia/i },
]

/** The niche a scrape query belongs to, or null when no rule claims it (never guessed). */
export function nicheForQuery(query: string | null | undefined, rules: readonly NicheRule[] = DEFAULT_NICHE_RULES): string | null {
  if (!query) return null
  for (const rule of rules) {
    if (rule.pattern.test(query)) return rule.niche
  }
  return null
}

/**
 * The scrape query of a prospect source: `metadata.query` (what Xcraper sends), else the part of
 * the label before " — " (the label is "<query> — <location>"), else null.
 */
export function queryOfSource(source: { label?: string | null; metadata?: unknown }): string | null {
  const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
    ? (source.metadata as Record<string, unknown>)
    : {}
  if (typeof metadata.query === 'string' && metadata.query.trim()) return metadata.query.trim()
  const label = source.label?.trim()
  if (!label) return null
  const [head] = label.split(/\s[—–-]\s/)
  return head?.trim() || null
}

/**
 * Whether a Google Maps category reads as a barber. Used only to REPORT how many neighbours
 * (hair salons, spas, nail bars...) a barbershop scrape pulled in; it never excludes anything.
 */
export function looksLikeBarber(category: unknown): boolean {
  if (typeof category !== 'string') return false
  return /barber|barbearia|men'?s\s+(hair|grooming|salon)|haircut|shave/i.test(category)
}

/** Parse `--rule "regex=niche"` into a NicheRule; throws on a malformed value or invalid slug. */
export function parseNicheRule(value: string): NicheRule {
  const at = value.lastIndexOf('=')
  if (at <= 0) throw new Error(`--rule must look like "regex=niche", got "${value}"`)
  const niche = value.slice(at + 1).trim()
  if (!isValidNiche(niche)) throw new Error(`--rule niche "${niche}" is not a valid niche slug`)
  return { niche, pattern: new RegExp(value.slice(0, at), 'i') }
}

/**
 * The new `custom_fields` for an account given the niches its source runs imply, or null when
 * nothing changes (it already carries all of them). Existing niches are never dropped.
 */
export function backfilledCustomFields(
  customFields: Record<string, unknown> | null,
  impliedNiches: string[],
): Record<string, unknown> | null {
  const existing = nichesFromCustomFields(customFields)
  const missing = impliedNiches.filter((niche) => !existing.includes(niche))
  if (missing.length === 0) return null
  const base = customFields ?? {}
  const niches = [...existing, ...missing]
  const primary = typeof base.niche === 'string' && isValidNiche(base.niche) ? base.niche : niches[0]
  return { ...base, niches, niche: primary }
}

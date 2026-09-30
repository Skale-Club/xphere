// src/lib/prospects/location-from-address.ts
//
// Item 5, 2026-09-30: `custom_fields.city` (read by the `prospect_rows` view,
// migration 1247 — there is no dedicated `city` column) was NULL on all 1044
// scraped prospects even though the full address was present in
// `custom_fields.address` (e.g. "…Tremont St, Boston, MA 02116"). The
// ingestion route (src/app/api/v1/prospects/route.ts) only ever stored
// whatever `custom_fields` the caller sent verbatim — it never derived
// `city`/`state` from an address string.
//
// deriveLocationFromAddress() fills that gap for the common
// "Street, City, ST[ ZIP]" shape. Used by:
//   - the ingestion route, for NEW prospects going forward
//   - scripts/backfill-prospect-city.ts, for the 1044 existing NULL rows

export interface DerivedLocation {
  city: string | null
  state: string | null
}

/**
 * Best-effort parse of a US-style "Street, City, ST[ ZIP]" address into
 * { city, state }. Never throws, never guesses beyond what the string
 * plainly says:
 *   - The last comma-separated segment is checked for a two-letter state
 *     code with an optional 5(+4)-digit ZIP ("MA 02116", "MA"). When found,
 *     the segment immediately before it is the city.
 *   - When no such suffix is recognized (no state on file, or a
 *     non-US address), the last segment is used as a best-effort city —
 *     still far more useful than the permanent NULL this replaces, but
 *     `state` stays null since nothing confirmed it.
 *   - Fewer than two comma-separated segments (e.g. a bare city name with no
 *     street) isn't enough to safely tell street from city — returns nulls
 *     rather than guessing.
 */
export function deriveLocationFromAddress(address: string | null | undefined): DerivedLocation {
  if (!address) return { city: null, state: null }
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return { city: null, state: null }

  const last = parts[parts.length - 1]
  const stateZipMatch = last.match(/^([A-Za-z]{2})\s*(?:\d{5}(?:-\d{4})?)?$/)
  if (stateZipMatch) {
    return { city: parts[parts.length - 2] || null, state: stateZipMatch[1].toUpperCase() }
  }
  return { city: last || null, state: null }
}

/**
 * Returns `custom_fields` with `city` (and `state`, when not already set)
 * filled from `address` or `location`, WITHOUT overwriting an existing
 * non-empty `city` — a structured value the source already sent is always
 * preferred over anything derived here. Returns the input unchanged
 * (same reference) when there is nothing to add, so callers can cheaply
 * check `result === input` if useful.
 */
export function withDerivedLocation<T extends Record<string, unknown>>(customFields: T | null | undefined): T | Record<string, unknown> {
  const cf = customFields ?? {}
  if (typeof cf.city === 'string' && cf.city.trim()) return cf

  const addressSource =
    typeof cf.address === 'string' && cf.address.trim()
      ? cf.address
      : typeof cf.location === 'string' && cf.location.trim()
        ? cf.location
        : null
  if (!addressSource) return cf

  const { city, state } = deriveLocationFromAddress(addressSource)
  if (!city) return cf

  return {
    ...cf,
    city,
    ...(state && !cf.state ? { state } : {}),
  }
}

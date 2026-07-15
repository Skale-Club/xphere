/**
 * Country-aware phone normalization for ingestion paths that receive
 * national-format numbers (external scrapers, CSV import) rather than the
 * E.164 strings the in-app <PhoneInput> already produces.
 *
 * Unlike `normalisePhone()` in `lib/contacts/zod-schemas.ts` (which only
 * strips non-digit characters), this uses libphonenumber-js to interpret a
 * bare national number against an explicit country hint. There is no way to
 * infer a 10-digit number's country from the digits alone, so multi-country
 * prospecting requires the caller to say which country a number belongs to.
 */

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

const ISO2_RE = /^[A-Za-z]{2}$/

/**
 * Normalize a raw phone number to E.164.
 *
 * - Input already in E.164 (`+...`) is parsed and re-validated as-is.
 * - Bare national-format input needs `countryHint` (ISO 3166-1 alpha-2, e.g.
 *   "US", "BR", "PT") to be interpreted correctly.
 * - Without a valid hint, or if parsing fails/the number is invalid, falls
 *   back to a best-effort digit-strip — we never guess a country, but we
 *   also never drop the value or reject the record over an untrustworthy
 *   phone field.
 */
export function normalizePhoneToE164(
  input: string | null | undefined,
  countryHint?: string | null,
): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null

  const country =
    countryHint && ISO2_RE.test(countryHint) ? (countryHint.toUpperCase() as CountryCode) : undefined

  try {
    const parsed = parsePhoneNumberFromString(trimmed, country)
    if (parsed?.isValid()) return parsed.number
  } catch {
    // Not parseable as a phone number at all — fall through to best-effort.
  }

  const plus = trimmed.startsWith('+') ? '+' : ''
  const digits = trimmed.replace(/[^0-9]/g, '')
  return digits ? plus + digits : null
}

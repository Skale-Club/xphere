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
import { normalisePhone } from '@/lib/contacts/zod-schemas'

const ISO2_RE = /^[A-Za-z]{2}$/

// MIR-02 (Xkedule<->Xphere integration audit 2026-07): curated IANA timezone
// -> ISO2 country map, mirroring Xkedule's own shared/timezones.ts
// countryForTimeZone 1:1 (same 14 zones, same 'US' fallback) so a tenant's
// default phone region derives identically on both sides of the integration.
const TIMEZONE_COUNTRY: Record<string, string> = {
  'America/Sao_Paulo': 'BR',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'Europe/Lisbon': 'PT',
  'Europe/London': 'GB',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Asia/Tokyo': 'JP',
  'Asia/Singapore': 'SG',
  'Australia/Sydney': 'AU',
  'Pacific/Auckland': 'NZ',
}

/**
 * ISO 3166-1 alpha-2 country for a curated timezone, defaulting to 'US' for
 * an unmapped/missing zone -- same fallback-of-last-resort Xkedule's
 * shared/timezones.ts::countryForTimeZone uses.
 */
export function countryForTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'US'
  return TIMEZONE_COUNTRY[timeZone] ?? 'US'
}

export interface PhoneCanonicalization {
  /** Best value to persist: real E.164 when derivable, else the legacy loose form (never null when input parses to *something*). */
  value: string | null
  /**
   * Every form worth matching against `contacts.phone_e164` (a STORED
   * generated column that only ever applied the loose normalize_phone() SQL
   * function -- see supabase/migrations/1056_contact_identity_audit.sql).
   * Reconciles a newly-canonicalized E.164 value against a legacy
   * loosely-normalized row (and vice versa) without a backfill migration:
   * includes the full E.164 form, the bare national number (what a legacy
   * row typed without a country code loosely-normalizes to), and the
   * loose-normalized form of the raw input itself.
   */
  matchCandidates: string[]
}

/**
 * MIR-02: canonicalize a raw phone number to real E.164 (with an optional
 * default-region hint, mirroring Xkedule's own resolveDefaultCountry), while
 * producing every legacy-compatible match candidate so dedup lookups against
 * `contacts.phone_e164` reconcile a voice caller-id number like
 * "+15551234567" with a legacy hand-typed contact stored as "5551234567"
 * (the exact P0-5/MIR-02 audit scenario) -- in either direction, regardless
 * of which side has the country hint. Never blocks a write over an
 * unparseable number: falls back to the same loose form
 * `normalisePhone`/the DB's `normalize_phone()` already produce.
 */
export function canonicalizeContactPhone(
  input: string | null | undefined,
  countryHint?: string | null,
): PhoneCanonicalization {
  if (!input) return { value: null, matchCandidates: [] }
  const trimmed = input.trim()
  if (!trimmed) return { value: null, matchCandidates: [] }

  const legacy = normalisePhone(trimmed)
  const candidates = new Set<string>()
  if (legacy) candidates.add(legacy)

  const country =
    countryHint && ISO2_RE.test(countryHint) ? (countryHint.toUpperCase() as CountryCode) : undefined

  try {
    const parsed = parsePhoneNumberFromString(trimmed, country)
    if (parsed?.isValid()) {
      candidates.add(parsed.number) // full E.164, e.g. "+15551234567"
      if (parsed.nationalNumber) candidates.add(parsed.nationalNumber) // bare digits, matches a legacy row typed without a country code
      return { value: parsed.number, matchCandidates: Array.from(candidates) }
    }
  } catch {
    // Not parseable as a phone number at all -- fall through to the legacy-only candidate.
  }

  return { value: legacy, matchCandidates: Array.from(candidates) }
}

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

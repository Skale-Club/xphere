// Phone numbers as sign-in identity, stored in E.164 ("+15085550100").
// Client-safe on purpose (no server-only): the sign-in dialog imports it too.
// Most users are in the US, so a bare 10-digit number is read as +1; anything
// else must carry its country code.

export const DEFAULT_COUNTRY_CODE = '1'

/** Country codes offered in the sign-in screen (the rest can be typed with +). `iso` picks the flag. */
export const PHONE_COUNTRIES = [
  { code: '1', label: 'US/CA', iso: 'US' },
  { code: '55', label: 'BR', iso: 'BR' },
  { code: '52', label: 'MX', iso: 'MX' },
  { code: '57', label: 'CO', iso: 'CO' },
  { code: '351', label: 'PT', iso: 'PT' },
  { code: '34', label: 'ES', iso: 'ES' },
] as const

/**
 * E.164 from what a person types, or null when it can't be a phone number.
 * `countryCode` is used when the input has no leading "+" (digits only).
 */
export function normalizePhone(
  input: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  // Only digits, spaces and the usual separators; no letters.
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  const cc = countryCode.replace(/\D/g, '')
  let e164: string
  if (raw.startsWith('+')) e164 = `+${digits}`
  else if (raw.startsWith('00')) e164 = `+${digits.slice(2)}`
  else if (cc === '1' && digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`
  else e164 = `+${cc}${digits}`
  // E.164: up to 15 digits; nothing real is shorter than 8.
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null
  // North American numbers are exactly +1 and 10 digits.
  if (e164.startsWith('+1') && e164.length !== 12) return null
  return e164
}

/** "+15085550100" -> "+1 (508) 555-0100"; Brazil gets its own grouping, others stay as is. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  if (m) return `+1 (${m[1]}) ${m[2]}-${m[3]}`
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164)
  if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`
  return e164
}

/** "+15085550100" -> "+1 •••• 0100", for messages that shouldn't show the whole number. */
export function maskPhone(e164: string): string {
  if (e164.length <= 6) return e164
  const country = e164.startsWith('+1') ? '+1' : e164.slice(0, 3)
  return `${country} •••• ${e164.slice(-4)}`
}

/**
 * Example for an empty phone field: zeros in the national format of the selected
 * country, so no real number or area code is suggested.
 */
export function phonePlaceholderFor(countryCode: string = DEFAULT_COUNTRY_CODE): string {
  switch (countryCode.replace(/\D/g, '')) {
    case '55': return '(00) 00000-0000'
    case '52': return '00 0000 0000'
    case '57': return '000 000 0000'
    case '351': return '000 000 000'
    case '34': return '000 00 00 00'
    default: return '(000) 000-0000'
  }
}

const COUNTRY_DIAL_CODES: Record<string, string> = {
  US: '1', CA: '1', BR: '55', MX: '52', CO: '57', PT: '351', ES: '34',
}

const LANGUAGE_DEFAULT_COUNTRIES: Record<string, string> = { en: 'US', pt: 'BR', es: 'ES' }

/** Returns a dial code when the detected country is offered by the sign-in picker. */
export function phoneCountryCodeFromIso(countryIso: string | null | undefined): string | null {
  if (!countryIso) return null
  return COUNTRY_DIAL_CODES[countryIso.trim().toUpperCase()] ?? null
}

/** Picks a dial code from the browser's BCP 47 language preferences. */
export function phoneCountryCodeFromLocales(locales: readonly string[]): string {
  for (const locale of locales) {
    const normalized = locale?.trim().replace('_', '-')
    if (!normalized) continue
    try {
      const code = phoneCountryCodeFromIso(new Intl.Locale(normalized).region)
      if (code) return code
    } catch {
      // Ignore malformed browser locale entries and try the next preference.
    }
  }
  for (const locale of locales) {
    const language = locale?.trim().toLowerCase().split(/[-_]/)[0]
    const code = phoneCountryCodeFromIso(LANGUAGE_DEFAULT_COUNTRIES[language])
    if (code) return code
  }
  return DEFAULT_COUNTRY_CODE
}

/** Reads common CDN geo headers. This only personalizes the harmless UI default. */
export function countryIsoFromHeaders(headers: { get(name: string): string | null }): string | null {
  for (const name of ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country']) {
    const value = headers.get(name)
    if (value && /^[a-z]{2}$/i.test(value)) return value.toUpperCase()
  }
  return null
}

/** The picker's dial codes, longest first so "351" is not read as "3". */
const PICKER_DIAL_CODES = ['351', '55', '52', '57', '34', '1'] as const

/** The dial code of a number in international form ("+16175551182" is "1"), or null when the picker does not offer it. */
export function dialCodeOf(phone: string | null | undefined): string | null {
  const text = (phone ?? '').trim()
  const digits = text.startsWith('+') ? text.replace(/\D/g, '') : ''
  return PICKER_DIAL_CODES.find((code) => digits.startsWith(code)) ?? null
}

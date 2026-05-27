/**
 * Phone-number display formatting.
 *
 * Inputs are stored as raw E.164 (`+15087001010`) so search, dedup and
 * server-side normalisation stay simple. Whenever a phone is RENDERED for
 * a human, run it through `formatPhoneDisplay()` first — never embed the
 * E.164 directly in JSX.
 *
 * Implementation reuses the `react-international-phone` country data and
 * per-country format mask we already ship for the editor, so the display
 * formatting matches what the editor shows while typing.
 */

import {
  defaultCountries,
  getActiveFormattingMask,
  guessCountryByPartialPhoneNumber,
} from 'react-international-phone'

/**
 * Format an E.164 phone number for human-readable display.
 *
 * @example
 *   formatPhoneDisplay('+15087001010') // '+1 (508) 700-1010'
 *   formatPhoneDisplay('+5511987654321') // '+55 (11) 98765-4321'
 *   formatPhoneDisplay(null) // ''
 *   formatPhoneDisplay('not a phone') // 'not a phone' (best-effort)
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''

  // Anything without a leading `+` is not E.164; return as-is so the caller
  // gets *some* value to display (e.g. legacy data) rather than blank.
  if (!trimmed.startsWith('+')) return trimmed

  let guess
  try {
    guess = guessCountryByPartialPhoneNumber({
      phone: trimmed,
      countries: defaultCountries,
      currentCountryIso2: undefined,
    })
  } catch {
    return trimmed
  }

  const country = guess?.country
  if (!country) return trimmed

  const dialCode = country.dialCode
  const digits = trimmed.replace(/\D/g, '')
  // Drop the country dial code prefix from the digit stream so the mask
  // applies only to the national number.
  const national = digits.startsWith(dialCode) ? digits.slice(dialCode.length) : digits

  let mask: string
  try {
    mask = getActiveFormattingMask({ phone: trimmed, country })
  } catch {
    return `+${dialCode} ${national}`
  }
  if (!mask) return `+${dialCode} ${national}`

  // Walk the mask, replacing each `.` placeholder with the next digit.
  // Any extra digits beyond the mask are appended at the end.
  let masked = ''
  let i = 0
  for (const ch of mask) {
    if (i >= national.length) break
    if (ch === '.') {
      masked += national[i]
      i += 1
    } else {
      masked += ch
    }
  }
  if (i < national.length) masked += national.slice(i)

  return `+${dialCode} ${masked}`.trim()
}

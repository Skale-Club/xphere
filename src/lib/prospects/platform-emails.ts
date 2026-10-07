// Scheduling / booking marketplace email classification.
//
// Um e-mail cujo dominio (ou qualquer subdominio) pertence a uma plataforma de agendamento ou
// marketplace NUNCA e o endereco do proprio negocio. Nunca verificar (nenhum credito gasto),
// nunca importar, nunca matricular, e reportar com motivo proprio (`platform_email`).
//
// Why this exists (measured 2026-10-07): Xcraper scrapes a barbershop's page on a booking
// marketplace and sometimes records the PLATFORM's own support address as the shop's email.
// `help.us@booksy.com` alone was on 38 accounts; 40 of 6,388 `accounts` rows carried a platform
// address (0 contacts), and 12 of those 40 had `email_status='ok'` — MillionVerifier credits were
// spent on them and they looked valid to the Hermes agent, because a Booksy inbox resolves and
// accepts mail. Xmail already refuses these on import and Xcraper filters at the source, but Xphere
// only had the `shared_email` heuristic (3+ distinct businesses on one address), so a platform
// address on a SINGLE shop sailed through and verification never skipped it. This module is the
// Xphere-side rule: a pure domain check, no query, no heuristic.
//
// KEEP IN SYNC with the other two copies of this list:
//   - Xmail:   src/server/lib/platform-emails.ts
//   - Xcraper: backend/src/services/emailPlaceholders.ts
// All three lists carry the same 19 domains since 2026-10-07; add a new platform to all three.

export const PLATFORM_EMAIL_DOMAINS: readonly string[] = [
  // Mirrors Xmail's list exactly
  'booksy.com',
  'vagaro.com',
  'styleseat.com',
  'schedulicity.com',
  'fresha.com',
  'setmore.com',
  'squareup.com',
  'square.site',
  'mindbodyonline.com',
  'glossgenius.com',
  'genbook.com',
  'acuityscheduling.com',
  'zenoti.com',
  'boulevard.io',
  'pocketsuite.io',
  // Xphere-only additions
  'getsquire.com',
  'mytime.com',
  'bookedin.com',
  // Xcraper lists it too (2026-10-07): the three lists must match.
  'booksy.net',
]

/**
 * True when `email`'s domain is a known scheduling/marketplace platform domain, or a subdomain of
 * one (`mail.booksy.com` yes, `notbooksy.com` no). Malformed input (null, empty, no `@`, nothing
 * after the `@`) is false — this only judges the domain, not whether the address is well-formed.
 */
export function isPlatformEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at === -1) return false
  const domain = normalized.slice(at + 1)
  if (!domain) return false
  return PLATFORM_EMAIL_DOMAINS.some((platform) => domain === platform || domain.endsWith(`.${platform}`))
}

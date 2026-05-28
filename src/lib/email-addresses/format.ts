/**
 * Email-address display formatting.
 *
 * Emails may be stored with inconsistent casing (user input, imports, external
 * integrations). Whenever an address is RENDERED for a human, run it through
 * `formatEmailDisplay()` so it shows lowercase everywhere — never embed the raw
 * stored value directly in JSX.
 *
 * Mirrors the `formatPhoneDisplay` contract in src/lib/phone-numbers/format.ts:
 * null/undefined/empty → '', otherwise a trimmed, lowercased address.
 */
export function formatEmailDisplay(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().toLowerCase()
}

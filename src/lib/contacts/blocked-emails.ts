/**
 * Hardcoded blocklist for placeholder/garbage email addresses (D-04, D-04a).
 *
 * Why: legacy CSV imports + some integrations stuff `noemail@*` /
 * `test@test.com` into the email column when no real email exists. These
 * pollute the partial UNIQUE index on (org_id, email_normalized) — every
 * import collides on `noemail@example.com` because every "no email" row
 * uses the same string. Blocked emails are silently treated as null at
 * the contact-write layer; the contact is still created via phone or
 * channel identity per Phase 109's invariant.
 *
 * Patterns match against the LOWERCASED + TRIMMED email. Domain-vs-localpart
 * matching: anchor with `^` for localpart, `@` boundary for domain.
 *
 * Per-org configurability is deferred to a follow-up (D-04b).
 *
 * Wire sites (D-04a):
 *   1. `src/lib/contacts/zod-schemas.ts` — contactSchema email refine chain
 *      (AFTER isValidEmail per Pitfall 8).
 *   2. `src/app/(dashboard)/contacts/actions.ts` — createContact defense in depth.
 *   3. CSV import (wired in Plan 110-06 alongside pre-flight refactor).
 *   4. Webhook handlers — currently no provider reads email from payload;
 *      sites documented with abstain comments where applicable.
 *
 * CRITICAL per Pitfall 4: webhook callers must NOT throw on blocked email.
 * Silently treat as null. Webhooks always return HTTP 200 (CLAUDE.md).
 *
 * CRITICAL per Pitfall 8: in zod chains, isValidEmail MUST come BEFORE
 * isBlockedEmail so invalid-shape emails fail fast with a clearer message.
 */

export const BLOCKED_EMAIL_PATTERNS: readonly RegExp[] = [
  /^noemail@/i,
  /^test@test\./i,
  /^none@/i,
  /^example@/i,
  /^placeholder@/i,
  /^noreply@/i,
  /@example\.(com|org)$/i,
] as const

/**
 * Returns true when the input email matches any BLOCKED_EMAIL_PATTERN.
 * Safe to call with null/undefined/empty — returns false, never throws.
 *
 * Matches against trim().toLowerCase() of the input. Substring-only matches
 * do NOT trigger (patterns are anchored with `^` for localpart, `$` for
 * domain).
 */
export function isBlockedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return false
  return BLOCKED_EMAIL_PATTERNS.some((rx) => rx.test(trimmed))
}

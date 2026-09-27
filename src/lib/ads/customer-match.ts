// Customer Match normalisation + hashing.
//
// Google matches uploaded contacts only when they are normalised exactly as it
// expects before SHA-256: emails trimmed and lower-cased (gmail/googlemail
// dots and "+tags" are left alone — Google handles those), phones in E.164.
// Hashing happens here, on the server, before a command is built, so the
// change ledger only ever stores digests — never an address or a number.

import { createHash } from 'node:crypto'

import { normalizePhoneToE164 } from '@/lib/phone-numbers/normalize'

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export function hashContacts(input: { emails?: string[]; phones?: string[]; defaultCountry?: string }): {
  hashed_emails: string[]
  hashed_phones: string[]
  rejected: number
} {
  const emails = new Set<string>()
  const phones = new Set<string>()
  let rejected = 0
  for (const raw of input.emails ?? []) {
    const email = normalizeEmail(raw)
    if (email) emails.add(sha256Hex(email))
    else rejected++
  }
  for (const raw of input.phones ?? []) {
    // normalizePhoneToE164 falls back to a bare digit string when it can't
    // place the number; Google would hash-match nothing with that, so only a
    // real E.164 value ("+" + country code) is accepted.
    const phone = normalizePhoneToE164(raw, input.defaultCountry)
    if (phone && /^\+\d{8,15}$/.test(phone)) phones.add(sha256Hex(phone))
    else rejected++
  }
  return { hashed_emails: [...emails], hashed_phones: [...phones], rejected }
}

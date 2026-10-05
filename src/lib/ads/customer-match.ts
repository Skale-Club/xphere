// Customer Match normalisation + hashing.
//
// Google matches uploaded contacts only when they are normalised exactly as it
// expects before SHA-256: emails trimmed and lower-cased (gmail/googlemail
// dots and "+tags" are left alone — Google handles those), phones in E.164.
// Hashing happens here, on the server, before a command is built. Google
// requires country + postal code unhashed for postal matching; names, emails
// and phone numbers are represented only by digests in the change ledger.

import { createHash } from 'node:crypto'

import { normalizePhoneToE164 } from '@/lib/phone-numbers/normalize'

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export type CustomerMatchAddress = {
  first_name: string
  last_name: string
  country_code: string
  postal_code: string
}

export type HashedCustomerMatchAddress = {
  hashed_first_name: string
  hashed_last_name: string
  country_code: string
  postal_code: string
}

function normalizeName(raw: string): string | null {
  const value = raw.normalize('NFKC').trim().toLowerCase()
  return value.length > 0 ? value : null
}

function normalizeAddress(raw: CustomerMatchAddress): HashedCustomerMatchAddress | null {
  const first = normalizeName(raw.first_name)
  const last = normalizeName(raw.last_name)
  const country = raw.country_code.trim().toUpperCase()
  const postal = raw.postal_code.trim().toUpperCase()
  if (!first || !last || !/^[A-Z]{2}$/.test(country) || !postal) return null
  return {
    hashed_first_name: sha256Hex(first),
    hashed_last_name: sha256Hex(last),
    country_code: country,
    postal_code: postal,
  }
}

export function hashContacts(input: { emails?: string[]; phones?: string[]; addresses?: CustomerMatchAddress[]; defaultCountry?: string }): {
  hashed_emails: string[]
  hashed_phones: string[]
  hashed_addresses: HashedCustomerMatchAddress[]
  rejected: number
} {
  const emails = new Set<string>()
  const phones = new Set<string>()
  const addresses = new Map<string, HashedCustomerMatchAddress>()
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
  for (const raw of input.addresses ?? []) {
    const address = normalizeAddress(raw)
    if (address) addresses.set(JSON.stringify(address), address)
    else rejected++
  }
  return { hashed_emails: [...emails], hashed_phones: [...phones], hashed_addresses: [...addresses.values()], rejected }
}

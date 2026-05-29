// src/lib/ghl/map-contact-to-xphere.ts
// Pure mapper: GHL contact → Xphere contact insert shape. No I/O. Shared by the
// one-off migration script today and any future "Import from GoHighLevel"
// feature. Dedup is decided downstream (by phone/email); external_id is
// populated as a harmless idempotency aid, not a dedup key.

import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'
import { composeContactName, titleCaseName } from '@/lib/contacts/names'
import { isBlockedEmail } from '@/lib/contacts/blocked-emails'
import type { GhlContact } from './list-contacts'

export interface MappedGhlContact {
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
  tags: string[]
  custom_fields: Record<string, unknown>
  external_id: string
  source: 'ghl_sync'
}

const blank = (v: string | null | undefined): string | null => {
  const t = v?.trim()
  return t ? t : null
}

/**
 * Maps a GHL contact into Xphere's normalised contact shape.
 *
 * @param ghl       Raw GHL contact from listAllGhlContacts.
 * @param cfIdToKey Map of custom-field id → readable key (getGhlCustomFieldKeyMap).
 *                  Custom field ids absent from the map fall back to the raw id.
 */
export function mapGhlContact(
  ghl: GhlContact,
  cfIdToKey: Record<string, string> = {},
): MappedGhlContact {
  // GHL often stores names lowercase; smart-title-case person names on the way
  // in (leading:false on the surname so "de souza" stays "de Souza"). Company
  // is intentionally left untouched | brand casing like "ShopperforUSA" must
  // survive.
  const firstName = titleCaseName(ghl.firstName, { leading: true })
  const lastName = titleCaseName(ghl.lastName, { leading: false })
  const name =
    composeContactName(firstName, lastName) ?? titleCaseName(ghl.contactName, { leading: true })

  // Blocked/placeholder emails are dropped to null so they don't pollute dedup;
  // the contact still imports on phone alone (matches CSV-import behaviour).
  const normalisedEmail = normaliseEmail(ghl.email ?? null)
  const email = normalisedEmail && !isBlockedEmail(normalisedEmail) ? normalisedEmail : null

  const custom_fields: Record<string, unknown> = {}
  for (const cf of ghl.customFields ?? []) {
    if (!cf?.id) continue
    if (cf.value === null || cf.value === undefined || cf.value === '') continue
    const key = cfIdToKey[cf.id] ?? cf.id
    custom_fields[key] = cf.value
  }

  return {
    first_name: firstName,
    last_name: lastName,
    name,
    phone: normalisePhone(ghl.phone ?? null),
    email,
    company: blank(ghl.companyName),
    tags: Array.isArray(ghl.tags) ? ghl.tags.filter((t) => typeof t === 'string' && t.trim()) : [],
    custom_fields,
    external_id: ghl.id,
    source: 'ghl_sync',
  }
}

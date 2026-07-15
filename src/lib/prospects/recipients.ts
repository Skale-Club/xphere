// src/lib/prospects/recipients.ts
//
// Pure recipient-resolution helper shared by the prospects bulk "Start voice
// campaign" and "Send WhatsApp" server actions (src/app/(dashboard)/prospects/
// actions.ts). Both actions start from the same shape of problem: a list of
// selected contact/account prospect rows, each with a raw (possibly
// non-E.164) phone value, that needs to become a deduped list of dialable
// recipients.
//
// Kept side-effect-free (no Supabase, no fetch) so it is unit-testable
// without mocking a client — see tests/prospect-recipients.test.ts.

import { normalizePhoneToE164 } from '@/lib/phone-numbers/normalize'

export type ProspectRecipientKind = 'person' | 'company'

export interface ProspectSourceRecord {
  kind: ProspectRecipientKind
  id: string
  name: string | null
  /** Raw phone value as stored (contacts.phone_e164 ?? contacts.phone, or accounts.phone). */
  phone: string | null
  /** ISO 3166-1 alpha-2 hint for interpreting a bare national-format phone, if known. */
  countryHint?: string | null
}

export interface ResolvedProspectRecipient {
  kind: ProspectRecipientKind
  id: string
  name: string
  /** Normalized E.164 phone number. */
  phone: string
}

export interface ResolveProspectRecipientsOptions {
  /** Maximum recipients to return; extras are reported via `truncated` instead of dropped silently. */
  cap?: number
  /** Used when a record has no name at all. */
  fallbackName?: string
}

export interface ResolveProspectRecipientsResult {
  recipients: ResolvedProspectRecipient[]
  /** Records with no usable phone number after normalization. */
  skippedNoPhone: number
  /** Records whose normalized phone matched an earlier record — first occurrence wins. */
  skippedDuplicate: number
  /** Recipients that would have qualified but were cut by `opts.cap`. */
  truncated: number
}

/**
 * Normalize, dedupe (by E.164 phone, first occurrence wins), and optionally
 * cap a batch of prospect records into a clean recipient list. Order of the
 * input array is preserved for both the dedup and the cap, so callers that
 * want a deterministic "who gets in when we're over the cap" behavior should
 * sort/order `records` themselves before calling this.
 */
export function resolveProspectRecipients(
  records: ProspectSourceRecord[],
  opts: ResolveProspectRecipientsOptions = {},
): ResolveProspectRecipientsResult {
  const seenPhones = new Set<string>()
  const recipients: ResolvedProspectRecipient[] = []
  let skippedNoPhone = 0
  let skippedDuplicate = 0

  for (const record of records) {
    const normalized = normalizePhoneToE164(record.phone, record.countryHint)
    if (!normalized) {
      skippedNoPhone += 1
      continue
    }
    if (seenPhones.has(normalized)) {
      skippedDuplicate += 1
      continue
    }
    seenPhones.add(normalized)
    const fallback = opts.fallbackName ?? (record.kind === 'company' ? 'Company' : 'Prospect')
    recipients.push({
      kind: record.kind,
      id: record.id,
      name: record.name?.trim() || fallback,
      phone: normalized,
    })
  }

  let truncated = 0
  let capped = recipients
  if (opts.cap != null && recipients.length > opts.cap) {
    truncated = recipients.length - opts.cap
    capped = recipients.slice(0, opts.cap)
  }

  return { recipients: capped, skippedNoPhone, skippedDuplicate, truncated }
}

/** Replace the literal `{{name}}` token in a template variable value with the recipient's name. */
export function applyNameToken(value: string, name: string): string {
  return value.replaceAll('{{name}}', name)
}

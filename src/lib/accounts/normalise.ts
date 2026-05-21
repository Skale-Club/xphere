import type { AccountSource } from '@/types/database'

/**
 * Normalises a domain string for index lookup and dedup.
 *   * trim
 *   * strip leading "http://" or "https://"
 *   * strip a single trailing "/"
 *   * lowercase
 *
 * Intentionally does NOT strip `www.` (tenants are free to keep or drop it;
 * dedup-by-domain in importAccountsCsv compares the normalised form, so
 * "Acme.com" and "acme.com" collapse, but "acme.com" and "www.acme.com"
 * remain distinct rows. The UI/import flow can layer a smarter heuristic
 * later | out of scope for v2.4 phase 65).
 *
 * Returns null on null/undefined/empty input.
 */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  let v = input.trim()
  if (!v) return null
  v = v.toLowerCase()
  v = v.replace(/^https?:\/\//, '')
  // Strip exactly one trailing slash if present at the end of the string
  if (v.endsWith('/')) v = v.slice(0, -1)
  return v || null
}

/**
 * DB-ready normalised account shape. Mirrors NormalisedContact's purpose:
 * post-zod, pre-Supabase. `''` / whitespace-only strings become null,
 * `domain` runs through normaliseDomain, tags array stays as-is.
 */
export interface NormalisedAccount {
  name: string
  domain: string | null
  website: string | null
  industry: string | null
  size: string | null
  phone: string | null
  address: string | null
  notes: string | null
  tags: string[]
  custom_fields: Record<string, unknown>
  external_id: string | null
  source: AccountSource
  assigned_to: string | null
}

const blank = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Transforms a zod-validated AccountInput into a DB-ready NormalisedAccount.
 * Caller is responsible for setting org_id and created_by separately on insert.
 */
export function normaliseAccountInput(input: {
  name: string
  domain?: string | null
  website?: string | null
  industry?: string | null
  size?: string | null
  phone?: string | null
  address?: string | null
  notes?: string | null
  tags?: string[]
  custom_fields?: Record<string, unknown>
  external_id?: string | null
  source?: AccountSource
  assigned_to?: string | null
}): NormalisedAccount {
  return {
    name: input.name.trim(),
    domain: normaliseDomain(input.domain ?? null),
    website: blank(input.website),
    industry: blank(input.industry),
    size: blank(input.size),
    phone: blank(input.phone),
    address: blank(input.address),
    notes: blank(input.notes),
    tags: input.tags ?? [],
    custom_fields: input.custom_fields ?? {},
    external_id: blank(input.external_id),
    source: input.source ?? 'manual',
    assigned_to: blank(input.assigned_to),
  }
}

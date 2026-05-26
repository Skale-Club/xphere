import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'

/**
 * Identity-aware contact id resolution.
 *
 * If `contactId` points to an archived_duplicate row, returns the
 * merged_into_contact_id (the live survivor). Otherwise returns input unchanged.
 *
 * Call from every server action / route handler that takes a contact_id from
 * user input and writes to a contact-linked table. Read paths (detail page,
 * list page, banner) MUST NOT call this — they need to render the archived
 * row with the merged banner.
 *
 * Chain protection: merge_contacts() rejects archived survivors (Pitfall 10),
 * so chains cannot be created. The recursion below is defensive only.
 *
 * Defensive behavior: any DB error returns the input unchanged. The caller
 * will fail naturally on the downstream write if the contact is truly gone,
 * with a clearer error than this helper could synthesize.
 */
export async function resolveLiveContactId(contactId: string): Promise<string> {
  if (!contactId) return contactId
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, identity_status, merged_into_contact_id')
    .eq('id', contactId)
    .maybeSingle()
  if (error || !data) return contactId
  if (data.identity_status === 'archived_duplicate' && data.merged_into_contact_id) {
    return resolveLiveContactId(data.merged_into_contact_id)
  }
  return contactId
}

/**
 * Look up a live contact by phone within an org (Phase 107 CID-07).
 *
 * Normalises the input via `normalisePhone` so callers can pass raw form
 * values. Filters out `archived_duplicate` rows so the lookup matches the
 * partial UNIQUE index predicate on `(org_id, phone_e164)` (see migration
 * 1059_contacts_unique_constraints.sql).
 *
 * Pass an authenticated Supabase client; RLS still applies. The `orgId`
 * argument is required because server actions already hold it and we avoid
 * the round-trip; webhook handlers usually look it up first.
 *
 * Returns `null` if the phone normalises to null or no live contact matches.
 */
export async function findByPhone(
  supabase: SupabaseClient<Database>,
  orgId: string,
  phone: string | null | undefined,
): Promise<{ id: string } | null> {
  const normalized = normalisePhone(phone ?? null)
  if (!normalized) return null
  const { data } = await supabase
    .from('contacts')
    .select('id')
    .eq('org_id', orgId)
    .eq('phone_e164', normalized)
    .neq('identity_status', 'archived_duplicate')
    .maybeSingle()
  return data ?? null
}

/**
 * Look up a live contact by email within an org (Phase 107 CID-08).
 *
 * Mirror of {@link findByPhone} for the `email_normalized` partial index.
 * Normalises via `normaliseEmail` (lower + trim). Filters out
 * `archived_duplicate` to match the partial UNIQUE index predicate on
 * `(org_id, email_normalized)`.
 *
 * Returns `null` if the email normalises to null or no live contact matches.
 */
export async function findByEmail(
  supabase: SupabaseClient<Database>,
  orgId: string,
  email: string | null | undefined,
): Promise<{ id: string } | null> {
  const normalized = normaliseEmail(email ?? null)
  if (!normalized) return null
  const { data } = await supabase
    .from('contacts')
    .select('id')
    .eq('org_id', orgId)
    .eq('email_normalized', normalized)
    .neq('identity_status', 'archived_duplicate')
    .maybeSingle()
  return data ?? null
}

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ContactIdentityStatus, ChannelProvider } from '@/types/database'
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

/**
 * Look up a live contact by channel identity (Phase 108 CID-11).
 *
 * Lookup-first webhook pattern (D-03): call BEFORE phone/email lookup.
 * Resolves through merged_into_contact_id chain so callers always get the
 * live survivor id even if the identity row points at an archived contact.
 *
 * Returns null if no identity row matches.
 */
export async function findByChannelIdentity(
  supabase: SupabaseClient<Database>,
  orgId: string,
  provider: ChannelProvider,
  externalId: string,
): Promise<
  | {
      contact_id: string
      identity_status: ContactIdentityStatus
      merged_into_contact_id: string | null
    }
  | null
> {
  if (!externalId) return null
  const { data: identity } = await supabase
    .from('contact_channel_identities')
    .select('contact_id')
    .eq('org_id', orgId)
    .eq('provider', provider)
    .eq('external_id', externalId)
    .maybeSingle()
  if (!identity) return null

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, identity_status, merged_into_contact_id')
    .eq('id', identity.contact_id)
    .maybeSingle()
  if (!contact) return null

  // Resolve through merged_into chain (defensive — chain depth > 1 prevented
  // by merge_contacts() guards in 1057, but follow once for safety).
  if (
    contact.identity_status === 'archived_duplicate' &&
    contact.merged_into_contact_id
  ) {
    const { data: live } = await supabase
      .from('contacts')
      .select('id, identity_status, merged_into_contact_id')
      .eq('id', contact.merged_into_contact_id)
      .maybeSingle()
    if (live) {
      return {
        contact_id: live.id,
        identity_status: live.identity_status,
        merged_into_contact_id: live.merged_into_contact_id,
      }
    }
  }

  return {
    contact_id: contact.id,
    identity_status: contact.identity_status,
    merged_into_contact_id: contact.merged_into_contact_id,
  }
}

/**
 * Insert a channel identity row attaching the contact. Idempotent on the
 * UNIQUE (org_id, provider, external_id) constraint — duplicate INSERT is
 * a no-op (recovers existing row by SELECT). Returns the resolved
 * (contact_id) for the (provider, external_id) pair regardless of insert vs.
 * conflict path.
 *
 * Callers: lookup-first webhook handlers (whatsapp/evolution/telegram) and
 * the linkConversationsToContacts server action.
 */
/**
 * Count live contacts in the current org with identity_status='merge_conflict'.
 *
 * Used by /contacts list page to render the "Conflicts (N)" filter chip
 * (Phase 110 D-08 / CID-15). RLS auto-scopes to the active org so no manual
 * org_id filter is required. Returns 0 when no rows match (chip renders
 * disabled with opacity-50 in that case, per Open Question 1).
 */
export async function getConflictCount(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('identity_status', 'merge_conflict')
  return count ?? 0
}

export async function attachChannelIdentity(
  supabase: SupabaseClient<Database>,
  orgId: string,
  contactId: string,
  provider: ChannelProvider,
  externalId: string,
): Promise<{ contact_id: string } | null> {
  if (!externalId || !contactId) return null
  const { error } = await supabase
    .from('contact_channel_identities')
    .insert({ org_id: orgId, contact_id: contactId, provider, external_id: externalId })
  if (error && error.code !== '23505') {
    console.error(
      `[contacts/attachChannelIdentity] insert failed provider=${provider} external_id=${externalId}: ${error.message}`,
    )
    return null
  }
  // On 23505 or success, the canonical row exists. Return the contact_id
  // pointed to by that row (may differ from `contactId` if another race
  // attached to a different contact — caller decides what to do).
  const { data } = await supabase
    .from('contact_channel_identities')
    .select('contact_id')
    .eq('org_id', orgId)
    .eq('provider', provider)
    .eq('external_id', externalId)
    .maybeSingle()
  return data ? { contact_id: data.contact_id } : null
}

/**
 * Phase 110 (CID-14): returns true if at least one row exists in
 * `contact_verifications` for the given contact. Used by `getContact` to
 * derive the `is_verified` boolean for the IdentityStatusBadge sub-state.
 *
 * Pitfall 7: single-contact scope only. DO NOT call this per-row from the
 * /contacts list page — it's an O(N) fanout. List pages render plain
 * `identity_status` without the verified sub-state.
 */
export async function hasVerifications(
  supabase: SupabaseClient<Database>,
  contactId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('contact_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', contactId)
    .limit(1)
  return (count ?? 0) > 0
}

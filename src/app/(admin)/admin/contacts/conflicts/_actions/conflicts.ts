'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'

async function assertAdmin() {
  const user = await getUser()
  if (!user || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    throw new Error('Unauthorized')
  }
  return user
}

/**
 * Merge `archivedId` into `survivorId`. Calls the SECURITY DEFINER SQL function
 * `merge_contacts` via the user-scoped Supabase client so `auth.uid()` resolves
 * inside the function (used as `merged_by` in `contact_merge_log`).
 *
 * Throws on:
 *   - non-admin caller
 *   - same id, archived target, archived survivor, cross-org (raised by SQL function)
 */
export async function mergeContacts(survivorId: string, archivedId: string): Promise<void> {
  await assertAdmin()
  if (!survivorId || !archivedId) throw new Error('mergeContacts: ids required')
  if (survivorId === archivedId) throw new Error('mergeContacts: survivor and archived must differ')

  // User-scoped client — forwards JWT so auth.uid() resolves inside SECURITY DEFINER (Pitfall 11)
  const supabase = await createClient()
  const { error } = await supabase.rpc('merge_contacts', {
    survivor_id: survivorId,
    archived_id: archivedId,
  })
  if (error) throw new Error(`Merge failed: ${error.message}`)

  // Order matters (Pitfall 9): RPC first, then revalidate so the page refetches post-merge state
  revalidatePath('/admin/contacts/conflicts')
}

/**
 * Mark contacts in a cluster as "not duplicates". Inserts every pairwise
 * combination (a<b sorted — Pitfall 7) into contact_merge_exclusions.
 * Uses service-role client because the admin is acting cross-org.
 */
export async function markAsSeparate(orgId: string, contactIds: string[]): Promise<void> {
  await assertAdmin()
  if (!orgId) throw new Error('markAsSeparate: orgId required')
  if (!Array.isArray(contactIds) || contactIds.length < 2) {
    throw new Error('markAsSeparate: need at least 2 contact ids')
  }

  // Build canonical-ordered pairs (Pitfall 7)
  const pairs: Array<{ org_id: string; contact_id_a: string; contact_id_b: string }> = []
  for (let i = 0; i < contactIds.length; i++) {
    for (let j = i + 1; j < contactIds.length; j++) {
      const [a, b] = [contactIds[i], contactIds[j]].sort()
      pairs.push({ org_id: orgId, contact_id_a: a, contact_id_b: b })
    }
  }

  const svc = createServiceRoleClient()
  const { error } = await svc
    .from('contact_merge_exclusions')
    .upsert(pairs, { onConflict: 'org_id,contact_id_a,contact_id_b' })
  if (error) throw new Error(`Mark-as-separate failed: ${error.message}`)

  revalidatePath('/admin/contacts/conflicts')
}

/**
 * Rebuild the contact_duplicate_audit table. Idempotent but expensive
 * (TRUNCATE + reinsert). Called only from the "Refresh audit" button.
 */
export async function refreshAudit(): Promise<void> {
  await assertAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('refresh_contact_duplicate_audit')
  if (error) throw new Error(`Refresh failed: ${error.message}`)
  revalidatePath('/admin/contacts/conflicts')
}

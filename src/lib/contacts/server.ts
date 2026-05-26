import 'server-only'
import { createClient } from '@/lib/supabase/server'

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

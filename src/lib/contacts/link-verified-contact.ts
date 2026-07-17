// src/lib/contacts/link-verified-contact.ts
// Link a webchat conversation to a CRM contact once its pinned commerce
// context carries a verified email (contract §3, UIX-03). Throttled: a
// conversation that already has a contact linked is skipped early and never
// re-linked/overwritten. The WHOLE body is wrapped in try/catch — this must
// NEVER throw (the chat route also wraps the call site, but this is
// defense-in-depth for any other future caller). See 137-RESEARCH.md
// Pattern 4 / Pitfall 5.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { findOrCreateContactByEmail } from '@/lib/contacts/find-or-create-by-email'

export async function linkVerifiedContact(
  supabase: SupabaseClient<Database>,
  orgId: string,
  conversationId: string,
  email: string,
): Promise<void> {
  try {
    // Throttle: an already-linked conversation is skipped — never re-linked
    // or overwritten.
    const { data: convo } = await supabase
      .from('conversations')
      .select('contact_id')
      .eq('id', conversationId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (convo?.contact_id) return

    const { contactId, email: norm } = await findOrCreateContactByEmail(supabase, orgId, email)
    if (!contactId || !norm) return

    // .is('contact_id', null) makes "only if currently null" atomic —
    // belt-and-suspenders with the throttle read above.
    await supabase
      .from('conversations')
      .update({ contact_id: contactId, visitor_email: norm })
      .eq('id', conversationId)
      .eq('org_id', orgId)
      .is('contact_id', null)
  } catch (err) {
    console.warn('[contacts/link-verified-contact] failed', err instanceof Error ? err.message : 'unknown error')
  }
}

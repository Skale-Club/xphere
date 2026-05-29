// Shared unsubscribe recording — used by the public page (GET) and the
// one-click route handler (POST). Service-role writes (RLS bypassed) since the
// caller is unauthenticated.

import { createServiceRoleClient } from '@/lib/supabase/admin'

export async function recordUnsubscribe(
  orgId: string,
  email: string,
  source: 'link' | 'one_click' | 'manual' | 'import',
): Promise<void> {
  const supabase = createServiceRoleClient()
  const normalized = email.trim().toLowerCase()

  // Idempotent: one row per (org_id, email).
  await supabase
    .from('email_unsubscribes')
    .upsert(
      { org_id: orgId, email: normalized, source },
      { onConflict: 'org_id,email', ignoreDuplicates: true },
    )

  // Backlink the contact + stop pending campaign sends to them.
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('org_id', orgId)
    .eq('email', normalized)
    .maybeSingle()

  if (contact?.id) {
    await supabase
      .from('email_unsubscribes')
      .update({ contact_id: contact.id })
      .eq('org_id', orgId)
      .eq('email', normalized)

    // Stop pending sends only for this org's EMAIL campaigns. An email opt-out
    // must not cancel the contact's pending WhatsApp/other-channel campaigns.
    const { data: emailCampaigns } = await supabase
      .from('campaigns')
      .select('id')
      .eq('organization_id', orgId)
      .eq('channel', 'email')
    const emailCampaignIds = (emailCampaigns ?? []).map((c) => c.id)

    if (emailCampaignIds.length > 0) {
      await supabase
        .from('campaign_recipients')
        .update({ status: 'unsubscribed' })
        .eq('contact_id', contact.id)
        .eq('status', 'pending')
        .in('campaign_id', emailCampaignIds)
    }
  }
}

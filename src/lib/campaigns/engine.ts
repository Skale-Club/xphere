// src/lib/campaigns/engine.ts
// Campaign execution engine | fires individual Vapi calls per contact.
// Used by the /api/campaigns/[id]/start server action.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, CampaignContactStatus } from '@/types/database'
import { createOutboundCall } from '@/lib/campaigns/outbound'
import { isDemoOrg } from '@/lib/demo/config'
import { createLogger } from '@/lib/obs/logger'

type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']

export function mapEndedReasonToStatus(reason: string | null | undefined): CampaignContactStatus {
  if (!reason) return 'failed'
  if (['customer-ended-call', 'assistant-ended-call', 'exceeded-max-duration'].includes(reason)) {
    return 'completed'
  }
  if (['customer-did-not-answer', 'customer-busy', 'voicemail'].includes(reason)) {
    return 'no_answer'
  }
  return 'failed'
}

export async function startCampaignBatch(
  campaignId: string,
  supabase: SupabaseClient<Database>,
  vapiApiKey: string
): Promise<{ fired: number; errors: number }> {
  // Fetch campaign | verify it is still in_progress (optimistic guard)
  const { data: campaign, error: campaignErr } = await supabase
    .from('campaigns')
    .select('id, organization_id, status, vapi_assistant_id, vapi_phone_number_id, calls_per_minute')
    .eq('id', campaignId)
    .single()

  const log = createLogger({ campaignId })

  if (campaignErr || !campaign) {
    log.error('campaign_fetch_failed', { error: campaignErr?.message })
    return { fired: 0, errors: 0 }
  }

  if (campaign.status !== 'in_progress') {
    log.info('campaign_skipped_not_in_progress', { status: campaign.status })
    return { fired: 0, errors: 0 }
  }

  // Demo safety invariant: the demo org never fires real outbound calls.
  // This engine runs under the service role (bypasses RLS), so guard explicitly.
  if (isDemoOrg(campaign.organization_id)) {
    log.warn('campaign_demo_org_outbound_blocked', {})
    return { fired: 0, errors: 0 }
  }

  // Voice campaigns require non-null vapi_assistant_id and vapi_phone_number_id
  if (!campaign.vapi_assistant_id || !campaign.vapi_phone_number_id) {
    log.error('campaign_missing_vapi_config', {})
    return { fired: 0, errors: 0 }
  }

  // Fetch candidate pending contacts up to concurrency limit
  const batchSize = Math.min(campaign.calls_per_minute, 10) // hard cap at 10
  const { data: candidates, error: contactsErr } = await supabase
    .from('campaign_contacts')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .limit(batchSize)

  if (contactsErr) {
    log.error('campaign_contacts_fetch_failed', { error: contactsErr.message })
    return { fired: 0, errors: 0 }
  }
  if (!candidates || candidates.length === 0) {
    // No more pending | check if campaign is complete
    await checkAndCompleteCampaign(campaignId, supabase)
    return { fired: 0, errors: 0 }
  }

  // Atomically claim the candidates BEFORE dialing: the `status='pending'`
  // guard on the UPDATE means concurrent batches (cron tick overlapping a
  // manual Resume, or a retried tick) each claim a disjoint set — a contact
  // can never be dialed twice. A claimed contact that crashes before dialing
  // stays 'calling' with a null vapi_call_id (visible, reconcilable) instead
  // of being silently re-dialed.
  const { data: contacts, error: claimErr } = await supabase
    .from('campaign_contacts')
    .update({ status: 'calling', updated_at: new Date().toISOString() })
    .in('id', candidates.map((c) => c.id))
    .eq('status', 'pending')
    .select('id, phone, name, custom_data')

  if (claimErr) {
    log.error('campaign_contacts_claim_failed', { error: claimErr.message })
    return { fired: 0, errors: 0 }
  }
  if (!contacts || contacts.length === 0) {
    // Another batch claimed these rows between our read and our claim.
    log.info('campaign_batch_lost_claim_race', { candidates: candidates.length })
    return { fired: 0, errors: 0 }
  }

  // Fire calls concurrently (Promise.allSettled | partial failure is acceptable)
  const results = await Promise.allSettled(
    contacts.map((contact) =>
      fireContactCall(contact, {
        ...campaign,
        vapi_assistant_id: campaign.vapi_assistant_id!,
        vapi_phone_number_id: campaign.vapi_phone_number_id!,
      }, supabase, vapiApiKey)
    )
  )

  const fired = results.filter((r) => r.status === 'fulfilled').length
  const errors = results.filter((r) => r.status === 'rejected').length
  return { fired, errors }
}

async function fireContactCall(
  contact: Pick<CampaignContactRow, 'id' | 'phone' | 'name' | 'custom_data'>,
  campaign: {
    id: string
    organization_id: string
    vapi_assistant_id: string
    vapi_phone_number_id: string
  },
  supabase: SupabaseClient<Database>,
  vapiApiKey: string
): Promise<void> {
  try {
    const { vapiCallId } = await createOutboundCall({
      contactId: contact.id,
      campaignId: campaign.id,
      phone: contact.phone,
      name: contact.name,
      assistantId: campaign.vapi_assistant_id,
      phoneNumberId: campaign.vapi_phone_number_id,
      vapiApiKey,
      customData: (contact.custom_data as Record<string, string>) ?? {},
    })

    // Row was already claimed (status='calling') before dialing; just attach
    // the call id and dial timestamp.
    const { error: updateErr } = await supabase
      .from('campaign_contacts')
      .update({
        vapi_call_id: vapiCallId,
        called_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
    if (updateErr) throw new Error(`Contact status update failed: ${updateErr.message}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    createLogger({ campaignId: campaign.id }).error('campaign_call_failed', { contactId: contact.id, error: msg })
    await supabase
      .from('campaign_contacts')
      .update({
        status: 'failed',
        error_detail: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
    throw err
  }
}

async function checkAndCompleteCampaign(
  campaignId: string,
  supabase: SupabaseClient<Database>
): Promise<void> {
  // Count contacts still in pending or calling state
  const { count } = await supabase
    .from('campaign_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'calling'])

  if (count === 0) {
    await supabase
      .from('campaigns')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'in_progress') // optimistic lock
  }
}

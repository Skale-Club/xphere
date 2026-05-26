'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { CampaignChannel, CampaignType, Json } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  name: string
  description?: string | null
  channel: CampaignChannel
  campaign_type?: CampaignType
  // Voice-specific
  vapi_assistant_id?: string | null
  vapi_phone_number_id?: string | null
  calls_per_minute?: number
  // SMS-specific
  sms_body?: string | null
  // Audience
  audience_filter?: Record<string, unknown>
  // Schedule
  scheduled_start_at?: string | null
  // UTM
  landing_page_url?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign_tag?: string | null
  utm_content?: string | null
  utm_term?: string | null
}

export interface CampaignMetrics {
  total: number
  sent: number
  delivered: number
  failed: number
  pending: number
  // Voice-specific
  completed_calls: number
  no_answer: number
  calling: number
}

// ─── createCampaign ───────────────────────────────────────────────────────────

export async function createCampaign(
  input: CreateCampaignInput
): Promise<{ id: string }> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) throw new Error('No organization found for user')

  const templateConfig: Json = input.channel === 'sms' && input.sms_body
    ? ({ sms_body: input.sms_body } as Json)
    : ({} as Json)

  const audienceFilter: Json = (input.audience_filter ?? {}) as unknown as Json

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      description: input.description ?? null,
      channel: input.channel,
      campaign_type: input.campaign_type ?? 'one_time',
      vapi_assistant_id: input.vapi_assistant_id ?? null,
      vapi_phone_number_id: input.vapi_phone_number_id ?? null,
      calls_per_minute: input.calls_per_minute ?? 5,
      audience_filter: audienceFilter,
      template_config: templateConfig,
      status: 'draft' as const,
      scheduled_start_at: input.scheduled_start_at ?? null,
      landing_page_url: input.landing_page_url ?? null,
      utm_source: input.utm_source ?? null,
      utm_medium: input.utm_medium ?? null,
      utm_campaign_tag: input.utm_campaign_tag ?? null,
      utm_content: input.utm_content ?? null,
      utm_term: input.utm_term ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/campaigns')
  return { id: data.id }
}

// ─── launchCampaign ───────────────────────────────────────────────────────────

export async function launchCampaign(id: string): Promise<void> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, channel, status')
    .eq('id', id)
    .single()

  if (!campaign) throw new Error('Campaign not found')
  if (!['draft', 'paused', 'scheduled'].includes(campaign.status)) {
    throw new Error(`Cannot launch a campaign with status "${campaign.status}"`)
  }

  if (campaign.channel === 'calls') {
    // Voice campaigns use the existing API route (POST /api/campaigns/[id]/start)
    // which handles Vapi key lookup and engine batching. We just update status here
    // as an optimistic gate; the full engine is triggered via the API route from the
    // client. For server-action callers, update to running status.
    const { error } = await supabase
      .from('campaigns')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['draft', 'paused', 'scheduled'])
    if (error) throw new Error(error.message)
  } else {
    // Non-voice campaigns: set to running (future: trigger SMS/email worker)
    const { error } = await supabase
      .from('campaigns')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['draft', 'paused', 'scheduled'])
    if (error) throw new Error(error.message)
  }

  revalidatePath('/campaigns')
  revalidatePath(`/campaigns/${id}`)
}

// ─── pauseCampaign ────────────────────────────────────────────────────────────

export async function pauseCampaign(id: string): Promise<void> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  const { error } = await supabase
    .from('campaigns')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['in_progress', 'running'])

  if (error) throw new Error(error.message)
  revalidatePath('/campaigns')
  revalidatePath(`/campaigns/${id}`)
}

// ─── cancelCampaign ───────────────────────────────────────────────────────────

export async function cancelCampaign(id: string): Promise<void> {
  const user = await getUser()
  if (!user) throw new Error('Unauthorized')
  const supabase = await createClient()

  const { error } = await supabase
    .from('campaigns')
    .update({ status: 'stopped', updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['draft', 'scheduled', 'in_progress', 'running', 'paused'])

  if (error) throw new Error(error.message)
  revalidatePath('/campaigns')
  revalidatePath(`/campaigns/${id}`)
}

// ─── getCampaigns ─────────────────────────────────────────────────────────────

export interface CampaignListItem {
  id: string
  organization_id: string
  name: string
  description: string | null
  channel: string
  campaign_type: string
  status: string
  scheduled_start_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  // Contact metrics (voice campaigns)
  total_contacts: number
  pending_contacts: number
  completed_contacts: number
  failed_contacts: number
}

export async function getCampaigns(channel?: string): Promise<CampaignListItem[]> {
  const supabase = await createClient()

  let query = supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false })

  if (channel && channel !== 'all') {
    query = query.eq('channel', channel)
  }

  const [campaignsRes, contactsRes] = await Promise.all([
    query,
    supabase.from('campaign_contacts').select('campaign_id, status'),
  ])

  if (campaignsRes.error) {
    console.error('[campaigns:getCampaigns] failed to load', campaignsRes.error)
    return []
  }

  const campaigns = campaignsRes.data ?? []
  const allContacts = contactsRes.data ?? []

  return campaigns.map((c) => {
    const contacts = allContacts.filter((cc) => cc.campaign_id === c.id)
    return {
      ...c,
      channel: c.channel ?? 'calls',
      campaign_type: c.campaign_type ?? 'one_time',
      description: c.description ?? null,
      started_at: c.started_at ?? null,
      completed_at: c.completed_at ?? null,
      total_contacts: contacts.length,
      pending_contacts: contacts.filter((cc) => cc.status === 'pending').length,
      completed_contacts: contacts.filter((cc) => cc.status === 'completed').length,
      failed_contacts: contacts.filter((cc) => cc.status === 'failed').length,
    }
  })
}

// ─── getCampaignMetrics ───────────────────────────────────────────────────────

export async function getCampaignMetrics(id: string): Promise<CampaignMetrics> {
  const supabase = await createClient()

  // For voice campaigns: pull from campaign_contacts
  const [contactsRes, recipientsRes] = await Promise.all([
    supabase
      .from('campaign_contacts')
      .select('status')
      .eq('campaign_id', id),
    supabase
      .from('campaign_recipients')
      .select('status')
      .eq('campaign_id', id),
  ])

  const contacts = contactsRes.data ?? []
  const recipients = recipientsRes.data ?? []

  // Voice call metrics
  const completed_calls = contacts.filter((c) => c.status === 'completed').length
  const no_answer = contacts.filter((c) => c.status === 'no_answer').length
  const calling = contacts.filter((c) => c.status === 'calling').length
  const voice_failed = contacts.filter((c) => c.status === 'failed').length
  const voice_pending = contacts.filter((c) => c.status === 'pending').length

  // SMS/email/whatsapp metrics from campaign_recipients
  const sent = recipients.filter((r) => r.status === 'sent').length
  const delivered = recipients.filter((r) => r.status === 'delivered').length
  const rec_failed = recipients.filter((r) => r.status === 'failed').length
  const rec_pending = recipients.filter((r) => r.status === 'pending').length

  const total = contacts.length + recipients.length

  return {
    total,
    sent: sent + completed_calls,
    delivered: delivered + completed_calls,
    failed: voice_failed + rec_failed,
    pending: voice_pending + rec_pending,
    completed_calls,
    no_answer,
    calling,
  }
}

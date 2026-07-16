// src/lib/vapi/end-of-call.ts
// Shared end-of-call-report handling for /api/vapi/calls AND /api/vapi/campaigns.
//
// Why this exists: a Vapi assistant/phone-number has exactly ONE server URL.
// Whichever of the two webhook routes is registered there, both a full call
// record (transcript, recording, cost, success evaluation) AND — when the call
// carries a campaign_contact_id — a campaign_contacts status update need to
// happen. Previously each route only did its own half, so campaigns pointed at
// /api/vapi/calls never completed (campaign_contacts stuck on 'calling'), and
// campaigns pointed at /api/vapi/campaigns never showed up in the calls hub
// (no transcript/cost/recording). Both routes now call both functions below.
//
// Idempotency: persistCallRecord is a plain insert keyed by the unique
// vapi_call_id column — a duplicate report (Vapi retry, or the same report
// landing on both routes when someone wires both URLs) hits 23505 and is
// swallowed. updateCampaignContactFromReport is a status UPDATE keyed by
// campaign_contact_id — re-applying the same terminal status is a no-op.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { VapiEndOfCallMessage } from '@/types/vapi'
import { mapEndedReasonToStatus } from '@/lib/campaigns/engine'
import { insertNotification } from '@/lib/notifications/insert'
import { createLogger } from '@/lib/obs/logger'

const obs = createLogger({ route: 'lib/vapi/end-of-call' })

export type EndOfCallReportMessage = VapiEndOfCallMessage['message']

// ---------------------------------------------------------------------------
// Org resolution
// ---------------------------------------------------------------------------

/**
 * Resolve org for a Vapi assistant ID.
 *
 * assistant_mappings is checked FIRST: vapi_assistant_id is UNIQUE (global)
 * there, so a hit is always unambiguous. twilio_phone_numbers.vapi_assistant_id
 * has no unique constraint — two numbers (even across orgs, by
 * misconfiguration) could reference the same assistant — so that fallback
 * orders by created_at ascending to make the pick deterministic instead of
 * whatever row order Postgres happens to return.
 */
export async function resolveOrgForAssistant(
  assistantId: string | null | undefined,
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  if (!assistantId) return null

  const { data: mapping } = await supabase
    .from('assistant_mappings')
    .select('organization_id')
    .eq('vapi_assistant_id', assistantId)
    .eq('is_active', true)
    .maybeSingle()
  if (mapping?.organization_id) return mapping.organization_id

  const { data: phoneRow } = await supabase
    .from('twilio_phone_numbers')
    .select('organization_id')
    .eq('vapi_assistant_id', assistantId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return phoneRow?.organization_id ?? null
}

// ---------------------------------------------------------------------------
// Call persistence
// ---------------------------------------------------------------------------

export interface PersistCallRecordResult {
  organizationId: string | null
  vapiCallId: string | null
  /** true when a new `calls` row was written (false on missing org, dup, or DB error). */
  inserted: boolean
  endedReason: string | null
}

export async function persistCallRecord(
  message: EndOfCallReportMessage,
  supabase: SupabaseClient<Database>,
): Promise<PersistCallRecordResult> {
  const { call, artifact, analysis, startedAt, endedAt, cost, endedReason } = message

  const vapiCallId = call?.id ?? null
  if (!vapiCallId) {
    obs.warn('vapi_missing_call_id')
    return { organizationId: null, vapiCallId: null, inserted: false, endedReason: endedReason ?? null }
  }

  const organizationId = await resolveOrgForAssistant(call?.assistantId, supabase)
  if (!organizationId) {
    obs.warn('vapi_no_assistant_mapping', { assistantId: call?.assistantId })
    return { organizationId: null, vapiCallId, inserted: false, endedReason: endedReason ?? null }
  }

  const recordingUrl = artifact?.recordingUrl ?? artifact?.stereoRecordingUrl ?? null
  const successEvaluation =
    analysis?.successEvaluation === undefined || analysis?.successEvaluation === null
      ? null
      : String(analysis.successEvaluation)

  const { error } = await supabase.from('calls').insert({
    organization_id: organizationId,
    vapi_call_id: vapiCallId,
    assistant_id: call?.assistantId ?? null,
    call_type: call?.type ?? null,
    status: call?.status ?? null,
    ended_reason: endedReason ?? null,
    started_at: startedAt ?? call?.startedAt ?? null,
    ended_at: endedAt ?? call?.endedAt ?? null,
    cost: cost ?? call?.cost ?? null,
    customer_number: call?.customer?.number ?? null,
    customer_name: call?.customer?.name ?? null,
    summary: analysis?.summary ?? null,
    transcript: artifact?.transcript ?? null,
    transcript_turns: (artifact?.messages ?? []) as Json,
    recording_url: recordingUrl,
    success_evaluation: successEvaluation,
    structured_data: (analysis?.structuredData ?? null) as Json,
  })

  let inserted = true
  if (error) {
    inserted = false
    // Duplicate vapi_call_id | idempotent: Vapi may retry, or the same report
    // may land on both /api/vapi/calls and /api/vapi/campaigns.
    if (error.code !== '23505') {
      obs.error('vapi_calls_insert_error', { error: error.message })
    }
  }

  // Emit missed_call notification for unanswered INBOUND calls (NOTIF-04).
  // Outbound campaign calls that go unanswered are a campaign outcome
  // (no_answer on campaign_contacts), not a missed call — notifying the whole
  // org for each one would spam every member's PWA during a campaign run.
  const missedCallReasons = ['no-answer', 'customer-did-not-answer']
  if (
    inserted &&
    endedReason &&
    missedCallReasons.includes(endedReason) &&
    call?.type !== 'outboundPhoneCall'
  ) {
    await insertNotification(organizationId, 'missed_call', {
      call_log_id: vapiCallId,
      customer_number: call?.customer?.number ?? null,
    })
  }

  return { organizationId, vapiCallId, inserted, endedReason: endedReason ?? null }
}

// ---------------------------------------------------------------------------
// Campaign contact status sync
// ---------------------------------------------------------------------------

export interface CampaignContactUpdateInput {
  campaignContactId: string
  vapiCallId: string | null
  endedReason: string | null
}

export async function updateCampaignContactFromReport(
  input: CampaignContactUpdateInput,
  supabase: SupabaseClient<Database>,
): Promise<void> {
  const { campaignContactId, vapiCallId, endedReason } = input
  const status = mapEndedReasonToStatus(endedReason)
  const isTerminal = status !== 'calling' && status !== 'pending'

  const { data: contact, error: updateErr } = await supabase
    .from('campaign_contacts')
    .update({
      status,
      vapi_call_id: vapiCallId ?? null,
      error_detail: status === 'failed' ? (endedReason ?? 'unknown') : null,
      completed_at: isTerminal ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignContactId)
    .select('campaign_id')
    .single()

  if (updateErr) {
    obs.error('vapi_campaigns_update_contact_failed', { error: updateErr.message, campaignContactId })
    return
  }
  if (!contact?.campaign_id) return

  // Check if all contacts are done | auto-complete campaign
  const { count } = await supabase
    .from('campaign_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', contact.campaign_id)
    .in('status', ['pending', 'calling'])

  if (count === 0) {
    await supabase
      .from('campaigns')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', contact.campaign_id)
      .eq('status', 'in_progress')
  }
}

/** Extract call.metadata.campaign_contact_id as a string, or null if absent/malformed. */
export function getCampaignContactId(message: EndOfCallReportMessage): string | null {
  const value = message.call?.metadata?.campaign_contact_id
  return typeof value === 'string' && value.length > 0 ? value : null
}

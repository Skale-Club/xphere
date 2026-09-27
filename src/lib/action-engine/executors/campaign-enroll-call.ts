// src/lib/action-engine/executors/campaign-enroll-call.ts
// Executor for the `campaign_enroll_call` action node: queue a phone callback.
//
// It ENROLS. It does not dial.
//
// Dialling straight from a workflow would look simpler and would bypass every
// control the outbound path has: the dialling window, the demo-org block, the
// calls-per-minute pacing, the retry policy, and — the one that breaks
// silently — `metadata.campaign_contact_id`, which is the only handle the
// end-of-call webhook has to write the result back. A call placed outside the
// campaign engine produces no status, no outcome and no row anybody can find.
//
// So the action writes one `campaign_contacts` row and lets the engine
// (src/lib/campaigns/engine.ts, driven by /api/cron/campaign-tick) do what it
// already does well.
//
// Never throws: same convention as the other executors here. Every refusal is
// a `status` the workflow run can log.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { checkDnd } from '@/lib/dnd'
import { isDemoOrg } from '@/lib/demo/config'

export interface ExecuteCampaignEnrollCallParams {
  orgId: string
  /** Takes precedence over campaignName. */
  campaignId?: string
  /** Name of an existing channel='calls' campaign in this org. */
  campaignName?: string
  phone: string
  name?: string | null
  /** contacts.id — used for the do-not-disturb check. */
  contactId?: string | null
  /** Becomes campaign_contacts.custom_data, which the robot reads as variableValues. */
  variables?: Record<string, unknown>
  onDuplicate?: 'skip' | 'requeue'
}

export type CampaignEnrollCallStatus =
  | 'enrolled'
  | 'requeued'
  | 'skipped_duplicate'
  | 'skipped_dnd'
  | 'skipped_no_phone'
  | 'skipped_demo_org'
  | 'failed'

export interface ExecuteCampaignEnrollCallResult {
  ok: boolean
  error?: string
  status: CampaignEnrollCallStatus
  campaignId: string | null
  campaignContactId: string | null
}

/** Vapi's variableValues are string-valued; anything else is coerced or dropped. */
function toStringMap(variables: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(variables ?? {})) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') continue
    out[key] = String(value)
  }
  return out
}

/**
 * E.164-ish: a leading + and 8-15 digits. The dialler gets nothing else.
 *
 * Takes `unknown` on purpose — the value arrives from a workflow's params,
 * which are JSON, so the declared type is a promise the runtime does not keep.
 */
function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/[\s()-]/g, '')
  if (!/^\+\d{8,15}$/.test(trimmed)) return null
  return trimmed
}

export async function executeCampaignEnrollCall(
  params: ExecuteCampaignEnrollCallParams,
): Promise<ExecuteCampaignEnrollCallResult> {
  const { orgId, campaignId, campaignName, phone, name, contactId, variables } = params
  const onDuplicate = params.onDuplicate ?? 'skip'
  // A policy outcome is a success: the platform decided not to dial and that
  // decision is the correct result. A bad phone number is NOT one of those —
  // it is a data error, and reporting it as ok:true is how an unreachable
  // customer disappears from a green workflow run.
  const POLICY_OUTCOMES: CampaignEnrollCallStatus[] = [
    'skipped_dnd',
    'skipped_duplicate',
    'skipped_demo_org',
  ]
  const miss = (status: CampaignEnrollCallStatus, error?: string): ExecuteCampaignEnrollCallResult => ({
    ok: POLICY_OUTCOMES.includes(status),
    error,
    status,
    campaignId: null,
    campaignContactId: null,
  })

  if (isDemoOrg(orgId)) return miss('skipped_demo_org')

  const e164 = normalisePhone(phone)
  if (!e164) return miss('skipped_no_phone', 'phone must be E.164, e.g. +5511987654321')

  if (!campaignId && !campaignName?.trim()) {
    return miss('failed', 'campaign_id or campaign_name is required')
  }

  // Service role: campaign_contacts is SELECT-only under RLS for authenticated
  // users, and a workflow run has no session of its own. Same reasoning as
  // startVoiceCampaignFromProspects().
  const supabase = createServiceRoleClient()

  // The first do-not-disturb check on the voice path. Until now only send_sms
  // honoured it, so a contact who asked not to be contacted could still be
  // dialled by a campaign.
  //
  // DND lives on a contact, but what gets dialled is a phone number, and the
  // two arrive as separate parameters. A caller that passes only the number —
  // which is every workflow that enrols from a form submission — would slip
  // past a DND flag set on the very person it is about to ring. So when no
  // contact was named, find the one that owns this number first.
  let dndContactId = contactId ?? null
  if (!dndContactId) {
    // NB: contacts is scoped by `org_id`; campaign_contacts by
    // `organization_id`. The two tables really do differ.
    const { data: byPhone } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone', e164)
      .limit(1)
      .maybeSingle()
    dndContactId = byPhone?.id ?? null
  }
  const dnd = await checkDnd(dndContactId, 'calls', supabase)
  if (dnd.blocked) return miss('skipped_dnd')

  // Resolve, never create. Creating a campaign here would mean choosing an
  // assistant and a caller-id number on the tenant's behalf, and a typo in
  // campaign_name would silently produce an un-dialable campaign nobody is
  // looking at. A missing campaign is a failure the workflow run should show.
  //
  // Two rows are fetched on purpose. Campaign names are not unique, so
  // .maybeSingle() on a duplicated name answers with PGRST116 — "JSON object
  // requested, multiple rows returned" — which tells whoever reads the run
  // nothing about what to do. Ask for two and say the real thing.
  const query = supabase
    .from('campaigns')
    .select('id, status, started_at, vapi_assistant_id, vapi_phone_number_id')
    .eq('organization_id', orgId)
    .eq('channel', 'calls')
  const { data: matches, error: campaignErr } = campaignId
    ? await query.eq('id', campaignId).limit(2)
    : await query.eq('name', campaignName!.trim()).limit(2)

  if (campaignErr) return miss('failed', campaignErr.message)
  if (!matches || matches.length === 0) {
    return miss('failed', `No calls campaign named "${campaignName ?? campaignId}" in this organization.`)
  }
  if (matches.length > 1) {
    return miss(
      'failed',
      `More than one calls campaign is named "${campaignName}". Enrol by campaign_id, or rename one of them.`,
    )
  }
  const campaign = matches[0]
  if (!campaign.vapi_assistant_id || !campaign.vapi_phone_number_id) {
    // startCampaignBatch would log and no-op, which looks like nothing
    // happened at all. Say it here instead.
    return miss('failed', 'That campaign has no assistant or caller-id number configured.')
  }

  const customData = toStringMap(variables)
  const nowIso = new Date().toISOString()

  const { data: inserted, error: insertErr } = await supabase
    .from('campaign_contacts')
    .insert({
      campaign_id: campaign.id,
      organization_id: orgId,
      name: name?.trim() || null,
      phone: e164,
      custom_data: customData,
      status: 'pending',
    })
    .select('id')
    .maybeSingle()

  let campaignContactId = inserted?.id ?? null
  let status: CampaignEnrollCallStatus = 'enrolled'

  if (insertErr) {
    // UNIQUE (campaign_id, phone) from migration 005: this person is already
    // in this campaign's queue or history.
    if (insertErr.code !== '23505') return miss('failed', insertErr.message)

    if (onDuplicate === 'skip') {
      return { ok: true, status: 'skipped_duplicate', campaignId: campaign.id, campaignContactId: null }
    }

    // Requeue overwrites the previous row — the unique constraint leaves no
    // alternative on an evergreen campaign. The `calls` rows written by
    // /api/vapi/calls keep the transcript and recording of the earlier call;
    // only this campaign row's own history is replaced.
    const { data: requeued, error: requeueErr } = await supabase
      .from('campaign_contacts')
      .update({
        status: 'pending',
        custom_data: customData,
        name: name?.trim() || null,
        vapi_call_id: null,
        error_detail: null,
        called_at: null,
        completed_at: null,
        retry_count: 0,
        next_attempt_at: null,
        updated_at: nowIso,
      })
      .eq('campaign_id', campaign.id)
      .eq('phone', e164)
      .select('id')
      .maybeSingle()

    if (requeueErr) return miss('failed', requeueErr.message)
    if (!requeued?.id) {
      // The insert hit the unique constraint, so the row existed a moment ago;
      // the update matched nothing, so it is gone now. Nothing is queued.
      // Reporting 'requeued' with a null id here would claim a callback that
      // no dialler will ever pick up.
      return miss('failed', 'The existing queue entry vanished mid-enrolment. Nothing was queued; try again.')
    }
    campaignContactId = requeued.id
    status = 'requeued'
  }

  // Re-arm AFTER the row exists, never before.
  //
  // A campaign that ran dry was flipped to 'completed' by the engine, and the
  // cron tick only selects 'in_progress'. Re-arming first would let a tick
  // land in between, find zero pending rows, and complete the campaign again —
  // with this enrolment inside it, invisible until someone notices the phone
  // never rang.
  //
  // ONLY from 'completed'. Every other status is somebody's decision, and the
  // one that matters is 'paused': an operator pauses a campaign precisely to
  // stop it dialling, and the runbook tells them to. Waking it here because a
  // new order arrived would undo that from behind — the phone starts ringing
  // again and nobody touched the campaign. 'draft' and 'scheduled' are the
  // same story: a campaign nobody has launched yet must not launch itself.
  if (campaign.status === 'completed') {
    const { error: armErr } = await supabase
      .from('campaigns')
      .update({
        status: 'in_progress',
        // Keep the original start: this campaign is being woken, not started.
        started_at: campaign.started_at ?? nowIso,
        updated_at: nowIso,
      })
      .eq('id', campaign.id)
      // Re-check the status in the WHERE clause: if somebody paused the
      // campaign between the SELECT above and this UPDATE, their pause wins.
      .eq('status', 'completed')
    if (armErr) return { ok: false, error: armErr.message, status: 'failed', campaignId: campaign.id, campaignContactId }
  }

  return { ok: true, status, campaignId: campaign.id, campaignContactId }
}

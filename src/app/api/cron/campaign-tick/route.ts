// src/app/api/cron/campaign-tick/route.ts
// GitHub Actions cron tick that advances stalled voice campaigns.
//
// Problem this fixes: startCampaignBatch() (src/lib/campaigns/engine.ts) fires
// a single batch of up to min(calls_per_minute, 10) 'pending' contacts and
// only runs when a user calls POST /api/campaigns/[id]/start (accepts
// draft/scheduled/paused). The Vapi end-of-call webhook (/api/vapi/campaigns)
// only updates campaign_contacts.status on call completion — it never re-fires
// the next batch. A voice campaign with more contacts than one batch stalls
// in status='in_progress' until a human repeatedly clicks Pause -> Resume.
//
// This tick is invoked on a schedule by .github/workflows/campaign-tick.yml.
// Each invocation:
//   1. Finds voice campaigns (channel='calls') currently status='in_progress'
//      (the status set by POST /start for the 'calls' channel — WhatsApp/SMS
//      campaigns use status='running' via a separate dispatcher and are out
//      of scope here).
//   2. For each (oldest-started first, capped at MAX_CAMPAIGNS_PER_TICK as a
//      global safety rail), calls startCampaignBatch() — the exact same
//      service-role-compatible function /start already calls. It internally
//      no-ops when there are no 'pending' contacts left (and auto-completes
//      the campaign once nothing is pending/calling), so it's safe to call
//      unconditionally on every in_progress voice campaign each tick.
//
// Cadence caveat: calls_per_minute is, in practice, "batch size per tick" —
// not a literal per-minute rate. See .github/workflows/campaign-tick.yml for
// the configured interval and its effect on real-world pacing.
//
// Out of scope (explicitly not implemented here): retrying 'failed' or
// 'no_answer' contacts. Only 'pending' rows are ever picked up by
// startCampaignBatch, so failed contacts stay failed until a dedicated retry
// feature is built — re-dialing automatically is a behavior change with
// consent implications and shouldn't be a side effect of this fix.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { startCampaignBatch } from '@/lib/campaigns/engine'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { captureApiError } from '@/lib/api-error'
import { createLogger } from '@/lib/obs/logger'

const CRON_SECRET = process.env.CRON_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Global safety rail: at most this many campaigns get a batch advanced per
// tick invocation. Each campaign still separately caps its own batch at
// min(calls_per_minute, 10) inside startCampaignBatch, so worst case this
// tick fires MAX_CAMPAIGNS_PER_TICK * 10 calls. Campaigns beyond the cap
// simply wait for the next tick (oldest-started campaigns are served first).
const MAX_CAMPAIGNS_PER_TICK = 5

interface TickCampaignRow {
  id: string
  organization_id: string
}

export async function GET(request: Request) {
  // Fail CLOSED when the secret is missing (unlike keepalive-style ticks):
  // this endpoint spends real money and dials real people, so it must never
  // be publicly invokable because an env var was forgotten.
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  const log = createLogger({ route: 'api/cron/campaign-tick' })
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const { data: campaigns, error: campaignsErr } = await supabase
    .from('campaigns')
    .select('id, organization_id')
    .eq('channel', 'calls')
    .eq('status', 'in_progress')
    .order('started_at', { ascending: true, nullsFirst: true })
    .limit(MAX_CAMPAIGNS_PER_TICK)

  if (campaignsErr) {
    log.error('campaign_tick_fetch_failed', { error: campaignsErr.message })
    captureApiError(campaignsErr)
    return Response.json({ ok: false, error: campaignsErr.message }, { status: 500 })
  }

  let advanced = 0
  let skippedNoKey = 0
  let firedTotal = 0
  let errorsTotal = 0

  for (const campaign of (campaigns ?? []) as TickCampaignRow[]) {
    const vapiApiKey = await getProviderKey('vapi', campaign.organization_id, supabase)
    if (!vapiApiKey) {
      skippedNoKey++
      log.warn('campaign_tick_missing_vapi_key', { campaignId: campaign.id })
      continue
    }

    try {
      const result = await startCampaignBatch(campaign.id, supabase, vapiApiKey)
      advanced++
      firedTotal += result.fired
      errorsTotal += result.errors
    } catch (err) {
      errorsTotal++
      log.error('campaign_tick_batch_failed', { campaignId: campaign.id, error: err })
      captureApiError(err, { campaignId: campaign.id })
    }
  }

  log.info('campaign_tick_complete', {
    campaignsConsidered: campaigns?.length ?? 0,
    campaignsAdvanced: advanced,
    skippedNoVapiKey: skippedNoKey,
    fired: firedTotal,
    errors: errorsTotal,
  })

  return Response.json({
    ok: true,
    campaigns_considered: campaigns?.length ?? 0,
    campaigns_advanced: advanced,
    skipped_no_vapi_key: skippedNoKey,
    fired: firedTotal,
    errors: errorsTotal,
  })
}

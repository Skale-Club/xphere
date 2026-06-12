// src/app/api/twilio/voice/continue/route.ts
// Routing-chain continuation webhook.
//
// Set as the <Dial action> for each chain stage rendered by /api/twilio/voice
// (and by this endpoint itself). Twilio POSTs here when a stage's dial ends:
//   * DialCallStatus=completed → a target answered and the call finished → done
//   * DialCallStatus=canceled  → the caller hung up before anyone answered → done
//   * busy | no-answer | failed → nobody answered → advance to the next stage
//
// Query string carries `org` (uuid) and `stage` (next stage index) — both
// signature-safe (no `+`/`%` that proxies might re-encode, unlike phone numbers,
// which is why the caller is recovered from POST params instead).

import { after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveTwilioCredentialsForOrg } from '@/lib/twilio/voice'
import {
  verifyTwilioSignature,
  resolveWebhookUrl,
  publicBaseUrl,
} from '@/lib/twilio/webhook-signature'
import {
  getRoutingChainForOrg,
  getRecordCallsForOrg,
  renderChainStage,
  fireIncomingCallPush,
} from '@/lib/calls/routing-chain'
import { twimlReject } from '@/lib/calls/twiml-builder'

export const runtime = 'nodejs'

const TWIML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' }

function twimlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: TWIML_HEADERS })
}

/** Write an authoritative terminal outcome for the parent inbound call leg. */
async function finalizeCall(
  callSid: string,
  status: 'completed' | 'canceled' | 'no-answer',
  durationSeconds?: number,
): Promise<void> {
  if (!callSid) return
  const supabase = createServiceRoleClient()
  const update: Record<string, unknown> = {
    status,
    ended_at: new Date().toISOString(),
  }
  if (Number.isFinite(durationSeconds) && (durationSeconds ?? 0) > 0) {
    update.duration_seconds = durationSeconds
  }
  await supabase.from('call_logs').update(update).eq('call_sid', callSid)
}

export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const orgId = url.searchParams.get('org') ?? ''
    const stageIndex = parseInt(url.searchParams.get('stage') ?? '', 10)

    const rawBody = await request.text()
    const params = new URLSearchParams(rawBody)
    const callSid = params.get('CallSid') ?? ''
    const from = params.get('From') ?? ''
    const dialStatus = (params.get('DialCallStatus') ?? '').toLowerCase()
    const dialDuration = parseInt(params.get('DialCallDuration') ?? '', 10)

    if (!orgId || !Number.isFinite(stageIndex)) {
      return twimlResponse(twimlReject())
    }

    // Validate the Twilio signature against the org's auth token.
    const creds = await resolveTwilioCredentialsForOrg(orgId)
    const authToken = creds?.authToken ?? ''
    const isValid = verifyTwilioSignature(
      authToken,
      resolveWebhookUrl(request),
      params,
      request.headers.get('x-twilio-signature'),
    )
    if (!isValid) {
      console.warn('[twilio/voice/continue] Invalid signature for org:', orgId)
      return new Response('Forbidden', { status: 403 })
    }

    // A target answered and the conversation ended → record + hang up.
    if (dialStatus === 'completed') {
      after(() => finalizeCall(callSid, 'completed', dialDuration))
      return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
    }

    // Caller abandoned the call before any stage answered → terminal hang up.
    if (dialStatus === 'canceled') {
      after(() => finalizeCall(callSid, 'canceled'))
      return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
    }

    // busy | no-answer | failed → advance to the next resolvable stage.
    const stages = await getRoutingChainForOrg(orgId)
    if (stages) {
      const baseUrl = publicBaseUrl(request)
      const ctx = {
        baseUrl,
        recordCalls: await getRecordCallsForOrg(orgId),
        callerId: from,
      }
      const rendered = await renderChainStage({ orgId, stages, startIndex: stageIndex, ctx })
      if (rendered) {
        if (rendered.pwaUserIds.length > 0) {
          after(() =>
            fireIncomingCallPush(orgId, rendered.pwaUserIds, {
              caller_number: from,
              call_id: callSid,
            }),
          )
        }
        return twimlResponse(rendered.twiml)
      }
    }

    // Chain exhausted, nobody answered → mark missed + voicemail prompt.
    after(() => finalizeCall(callSid, 'no-answer'))
    return twimlResponse(
      twimlReject('No agent is currently available. Please leave a message after the tone.'),
    )
  } catch (err) {
    console.error('[twilio/voice/continue] handler error:', err)
    return twimlResponse(twimlReject())
  }
}

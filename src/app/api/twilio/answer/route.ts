// POST /api/twilio/answer
// "Answer on this device" for routing-chain calls (SEED-024 / v3.5 phase 2).
//
// A web-push wakes the PWA while the chain stage is still ringing. The push's
// <Client> leg died the moment the stage dialed (the SDK wasn't connected), so
// simply opening the app cannot answer THAT call. Instead the app calls this
// endpoint: we verify the call is still unanswered, then rewrite the parent
// call's TwiML to dial the answering user's Voice SDK client — the (now
// registered) browser/PWA rings and the user picks up in-app.

import { getUser, createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  resolveTwilioCredentialsForOrg,
  redirectCall,
  twilioBasicAuthHeader,
  CallNotInProgressError,
} from '@/lib/twilio/voice'
import { getRecordCallsForOrg } from '@/lib/calls/routing-chain'
import { twimlForwardToClient } from '@/lib/calls/twiml-builder'
import { publicBaseUrl } from '@/lib/twilio/webhook-signature'
import { generateClientIdentity } from '@/lib/calls/zod-schemas'
import { captureApiError } from '@/lib/api-error'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as { callSid?: string }
    const callSid = typeof body.callSid === 'string' ? body.callSid.trim() : ''
    if (!callSid) return Response.json({ error: 'callSid required' }, { status: 422 })

    // RLS-scoped lookup: only resolves if the call belongs to the user's org.
    const supabase = await createClient()
    const { data: log } = await supabase
      .from('call_logs')
      .select('id, org_id, call_sid, status, from_number, direction')
      .eq('call_sid', callSid)
      .maybeSingle()

    if (!log) return Response.json({ error: 'Call not found' }, { status: 404 })
    if (log.direction !== 'inbound' || !['ringing', 'initiated', 'in-progress'].includes(log.status ?? '')) {
      return Response.json({ error: 'call_ended' }, { status: 409 })
    }

    const creds = await resolveTwilioCredentialsForOrg(log.org_id)
    if (!creds) return Response.json({ error: 'Twilio not configured' }, { status: 422 })

    // Someone may have picked up on another leg while the push was in flight.
    // A live child call under this parent means the call is already answered —
    // redirecting now would rip the audio away from whoever answered.
    const childUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls.json` +
      `?ParentCallSid=${encodeURIComponent(callSid)}&Status=in-progress&PageSize=1`
    const childRes = await fetch(childUrl, {
      headers: { Authorization: twilioBasicAuthHeader(creds) },
      cache: 'no-store',
    })
    if (childRes.ok) {
      const children = (await childRes.json()) as { calls?: unknown[] }
      if ((children.calls?.length ?? 0) > 0) {
        return Response.json({ error: 'already_answered' }, { status: 409 })
      }
    }

    // Ensure the answering user has a Voice SDK identity to dial.
    const admin = createServiceRoleClient()
    const { data: settings } = await admin
      .from('call_settings')
      .select('id, twilio_client_identity')
      .eq('org_id', log.org_id)
      .eq('user_id', user.id)
      .maybeSingle()

    let identity = settings?.twilio_client_identity ?? null
    if (!identity) {
      identity = generateClientIdentity(user.id)
      if (settings?.id) {
        await admin.from('call_settings').update({ twilio_client_identity: identity }).eq('id', settings.id)
      } else {
        await admin.from('call_settings').insert({
          org_id: log.org_id,
          user_id: user.id,
          routing_mode: 'browser',
          twilio_client_identity: identity,
        })
      }
    }

    const twiml = twimlForwardToClient(identity, {
      baseUrl: publicBaseUrl(request),
      recordCalls: await getRecordCallsForOrg(log.org_id),
      callerId: log.from_number ?? undefined,
    })

    try {
      await redirectCall(creds, callSid, twiml)
    } catch (err) {
      if (err instanceof CallNotInProgressError) {
        return Response.json({ error: 'call_ended' }, { status: 409 })
      }
      throw err
    }

    return Response.json({ ok: true, identity })
  } catch (err) {
    console.error('[twilio/answer] handler error:', err)
    captureApiError(err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}

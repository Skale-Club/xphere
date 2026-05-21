// src/app/api/twilio/status/route.ts
// Twilio Call Status webhook (SEED-007).
// Receives lifecycle events for an in-flight or completed call:
//   CallSid, CallStatus, CallDuration, From, To, Timestamp, AnsweredBy
//
// On `completed`/`no-answer`/`busy`/`failed`/`canceled`:
//   * updates call_logs status + duration_seconds + ended_at
//   * best-effort contact linkage by phone

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  verifyTwilioSignature,
  resolveWebhookUrl,
} from '@/lib/twilio/webhook-signature'
import { resolveTwilioCredentialsForOrg } from '@/lib/twilio/voice'

export const runtime = 'nodejs'

const TERMINAL_STATUSES = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled'])

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text()
    const params = new URLSearchParams(rawBody)

    const callSid = params.get('CallSid') ?? ''
    const callStatus = params.get('CallStatus') ?? ''
    const durationStr = params.get('CallDuration') ?? params.get('Duration') ?? ''
    const duration = parseInt(durationStr, 10)
    const from = params.get('From') ?? ''
    const to = params.get('To') ?? ''

    if (!callSid) {
      return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const supabase = createServiceRoleClient()
    const { data: callLog } = await supabase
      .from('call_logs')
      .select('id, org_id, contact_id, direction, from_number, to_number')
      .eq('call_sid', callSid)
      .limit(1)
      .maybeSingle()

    if (!callLog) {
      return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
    }

    const creds = await resolveTwilioCredentialsForOrg(callLog.org_id)
    if (creds) {
      const isValid = verifyTwilioSignature(
        creds.authToken,
        resolveWebhookUrl(request),
        params,
        request.headers.get('x-twilio-signature'),
      )
      if (!isValid) {
        console.warn('[twilio/status] Invalid signature for CallSid:', callSid)
        return new Response('Forbidden', { status: 403 })
      }
    }

    const isTerminal = TERMINAL_STATUSES.has(callStatus)
    const update: Record<string, unknown> = { status: callStatus || null }
    if (isTerminal) {
      update.ended_at = new Date().toISOString()
      if (Number.isFinite(duration) && duration > 0) update.duration_seconds = duration
    }

    // Late contact linkage | if status webhook arrives with phone info and we
    // didn't have a contact at insert time, try again.
    if (!callLog.contact_id) {
      const lookup = callLog.direction === 'inbound'
        ? (callLog.from_number ?? from)
        : (callLog.to_number ?? to)
      if (lookup) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('id')
          .eq('org_id', callLog.org_id)
          .eq('phone', lookup)
          .limit(1)
          .maybeSingle()
        if (contact) update.contact_id = contact.id
      }
    }

    await supabase.from('call_logs').update(update).eq('id', callLog.id)

    // Empty TwiML | Twilio doesn't expect any verbs on status callbacks.
    return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  } catch (err) {
    console.error('[twilio/status] handler error:', err)
    return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }
}

// src/app/api/twilio/outbound/route.ts
// Server-initiated outbound call (Mode A | phone_forward). Modes B and C dial
// directly from the user's softphone / browser SDK; this endpoint exists for
// Mode A users (and the dashboard "click-to-call" fallback for any mode).
//
// Auth: getUser() | only authenticated org members can initiate calls.
// Flow (classic Twilio click-to-call — ring the operator first, then bridge):
//   1. Resolve the org "from" number + its `forward_to_number` (the phone that
//      should ring). Falls back to the user's call_settings.phone_forward.
//   2. Use the Twilio REST API to dial the OPERATOR: From={org number},
//      To={forward target}, Url=/api/twilio/voice?dialTo={contact}.
//   3. When the operator answers, /api/twilio/voice (Direction=outbound-api)
//      bridges the call to {contact} with the org number as caller ID.

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { resolveTwilioCredentialsForOrg, createOutboundCall } from '@/lib/twilio/voice'
import { publicBaseUrl } from '@/lib/twilio/webhook-signature'

export const runtime = 'nodejs'

const bodySchema = z.object({
  to: z.string().min(3).max(32),
  from: z.string().min(3).max(32).optional(),
})

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const json = (await request.json().catch(() => null)) as unknown
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body | expected { to: string }' }, { status: 400 })
  }
  const { to, from: fromOverride } = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return Response.json({ error: 'No active organization' }, { status: 400 })

  const creds = await resolveTwilioCredentialsForOrg(orgId)
  if (!creds) {
    return Response.json({ error: 'Twilio is not connected for this organization.' }, { status: 400 })
  }

  // Resolve the org "from" number + its forward target. The dialer rings this
  // forward number (the operator) first, then bridges to the contact. The
  // forward target is configured per-number in Calls → Phone Numbers.
  let fromNumber = creds.fromNumber
  let forwardTarget: string | null = null
  if (fromOverride) {
    const { data: phoneRow } = await supabase
      .from('twilio_phone_numbers')
      .select('e164, forward_to_number')
      .eq('e164', fromOverride)
      .eq('is_active', true)
      .maybeSingle()
    if (!phoneRow) {
      return Response.json({ error: 'From-number not found in this organization.' }, { status: 400 })
    }
    fromNumber = phoneRow.e164
    forwardTarget = phoneRow.forward_to_number
  } else if (fromNumber) {
    const { data: phoneRow } = await supabase
      .from('twilio_phone_numbers')
      .select('forward_to_number')
      .eq('e164', fromNumber)
      .eq('is_active', true)
      .maybeSingle()
    forwardTarget = phoneRow?.forward_to_number ?? null
  }

  if (!fromNumber) {
    return Response.json({ error: 'No Twilio from-number configured.' }, { status: 400 })
  }

  // Personal call_settings is a fallback source for the forward number and the
  // recording preference. The row is optional — most orgs configure routing on
  // the number itself.
  const { data: settings } = await supabase
    .from('call_settings')
    .select('routing_mode, record_calls, phone_forward')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!forwardTarget) forwardTarget = settings?.phone_forward ?? null

  if (!forwardTarget) {
    return Response.json(
      {
        error:
          'No forwarding number set for this line. In Calls → Phone Numbers, set its routing to "Forward to number" and enter the phone that should ring.',
      },
      { status: 400 },
    )
  }

  const base = publicBaseUrl(request)
  // Twilio fetches the TwiML + status callbacks from these URLs, so they must be
  // publicly reachable. A localhost base means we're on a dev server Twilio can't
  // reach — fail early with an actionable message instead of the cryptic Twilio
  // 21205 ("Url is not a valid URL").
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base)) {
    return Response.json(
      {
        error:
          'Outbound calls need a public webhook URL — Twilio cannot reach localhost. Test on production (xphere.app) or set TWILIO_WEBHOOK_BASE_URL to a public tunnel (e.g. ngrok).',
      },
      { status: 400 },
    )
  }
  // No query string on the TwiML URL: Twilio signs the full URL and proxies can
  // re-encode a `+` in the query, breaking signature validation (which silently
  // drops the bridge → call connects with no audio). The voice webhook resolves
  // the contact from the call_logs row by CallSid instead (see /api/twilio/voice).
  const twimlUrl = `${base}/api/twilio/voice`
  const statusCallback = `${base}/api/twilio/status`

  try {
    const { sid } = await createOutboundCall(creds, {
      to: forwardTarget, // ring the operator first
      from: fromNumber, // org number as caller ID on the operator leg
      twimlUrl,
      statusCallback,
      // Recording is applied on the bridged <Dial> in /api/twilio/voice so the
      // recordingStatusCallback fires and the file is stored in our system.
    })

    // Insert an initial call_logs row | the status webhook will fill in the rest.
    // to_number is the contact (the logical target), not the operator's phone.
    await supabase.from('call_logs').insert({
      org_id: orgId,
      call_sid: sid,
      direction: 'outbound',
      routing_mode: settings?.routing_mode ?? 'phone_forward',
      from_number: fromNumber,
      to_number: to,
      status: 'initiated',
      started_at: new Date().toISOString(),
      created_by: user.id,
    })

    return Response.json({ sid })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Outbound call failed'
    return Response.json({ error: message }, { status: 502 })
  }
}

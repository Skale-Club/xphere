// src/app/api/twilio/outbound/route.ts
// Server-initiated outbound call (Mode A — phone_forward). Modes B and C dial
// directly from the user's softphone / browser SDK; this endpoint exists for
// Mode A users (and the dashboard "click-to-call" fallback for any mode).
//
// Auth: getUser() — only authenticated org members can initiate calls.
// Flow:
//   1. Read the user's call_settings (must exist + have a forward target)
//   2. Use the Twilio REST API to dial: From=org Twilio number, To={contact}
//   3. Twilio then calls /api/twilio/voice with `Direction=outbound-api`, which
//      builds a TwiML bridge to the user's configured phone_forward.

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { resolveTwilioCredentialsForOrg, createOutboundCall } from '@/lib/twilio/voice'
import { publicBaseUrl } from '@/lib/twilio/webhook-signature'

export const runtime = 'nodejs'

const bodySchema = z.object({
  to: z.string().min(3).max(32),
})

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const json = (await request.json().catch(() => null)) as unknown
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body — expected { to: string }' }, { status: 400 })
  }
  const { to } = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return Response.json({ error: 'No active organization' }, { status: 400 })

  const { data: settings } = await supabase
    .from('call_settings')
    .select('routing_mode, record_calls, phone_forward')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings) {
    return Response.json(
      { error: 'No call settings — configure them in /settings/calls first.' },
      { status: 400 },
    )
  }

  const creds = await resolveTwilioCredentialsForOrg(orgId)
  if (!creds) {
    return Response.json({ error: 'Twilio is not connected for this organization.' }, { status: 400 })
  }
  if (!creds.fromNumber) {
    return Response.json({ error: 'No Twilio from-number configured.' }, { status: 400 })
  }

  const base = publicBaseUrl(request)
  const twimlUrl = `${base}/api/twilio/voice`
  const statusCallback = `${base}/api/twilio/status`

  try {
    const { sid } = await createOutboundCall(creds, {
      to,
      from: creds.fromNumber,
      twimlUrl,
      statusCallback,
      record: settings.record_calls,
    })

    // Insert an initial call_logs row — the status webhook will fill in the rest.
    await supabase.from('call_logs').insert({
      org_id: orgId,
      call_sid: sid,
      direction: 'outbound',
      routing_mode: settings.routing_mode,
      from_number: creds.fromNumber,
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

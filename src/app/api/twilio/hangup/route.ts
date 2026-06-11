// src/app/api/twilio/hangup/route.ts
// Ends an in-flight outbound call from the dialer (phone_forward / sip modes),
// where the browser is not part of the call and can't disconnect it locally.
//
// Auth: getUser() | only authenticated org members can end their org's calls.
// The call_logs row must belong to the caller's active org (verified via RLS
// through the authenticated client) before we touch the Twilio REST API.

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { resolveTwilioCredentialsForOrg, endCall } from '@/lib/twilio/voice'

export const runtime = 'nodejs'

const bodySchema = z.object({
  sid: z.string().min(3).max(64),
})

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const json = (await request.json().catch(() => null)) as unknown
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body | expected { sid: string }' }, { status: 400 })
  }
  const { sid } = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return Response.json({ error: 'No active organization' }, { status: 400 })

  // RLS-scoped read: confirms the call belongs to the caller's org before we act.
  const { data: callLog } = await supabase
    .from('call_logs')
    .select('id')
    .eq('call_sid', sid)
    .maybeSingle()
  if (!callLog) {
    return Response.json({ error: 'Call not found' }, { status: 404 })
  }

  const creds = await resolveTwilioCredentialsForOrg(orgId)
  if (!creds) {
    return Response.json({ error: 'Twilio is not connected for this organization.' }, { status: 400 })
  }

  try {
    await endCall(creds, sid)
    return Response.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to end call'
    return Response.json({ error: message }, { status: 502 })
  }
}

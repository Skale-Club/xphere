// src/app/api/twilio/token/route.ts
// Issues a Twilio Voice SDK Access Token for the authenticated user.
//
// Auth: getUser() (cached helper). RLS scopes the call_settings lookup to the
// active org. The org's Twilio integration must have `api_key_sid`,
// `api_key_secret`, and `twiml_app_sid` configured | otherwise we return 400
// with a helpful error message so the UI can guide the admin through setup.

import { createClient, getUser } from '@/lib/supabase/server'
import { resolveTwilioCredentialsForOrg } from '@/lib/twilio/voice'
import { generateVoiceToken } from '@/lib/twilio/access-token'

export const runtime = 'nodejs'

export async function POST(): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return Response.json({ error: 'No active organization' }, { status: 400 })

  const { data: settings } = await supabase
    .from('call_settings')
    .select('twilio_client_identity, routing_mode')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings?.twilio_client_identity) {
    return Response.json(
      { error: 'Browser calling is not configured for this user. Pick a Browser identity in /settings/calls.' },
      { status: 400 },
    )
  }

  const creds = await resolveTwilioCredentialsForOrg(orgId)
  if (!creds) {
    return Response.json(
      { error: 'Twilio is not connected for this organization.' },
      { status: 400 },
    )
  }
  if (!creds.apiKeySid || !creds.apiKeySecret || !creds.twimlAppSid) {
    return Response.json(
      {
        error:
          'Twilio API Key + TwiML App SID are required for browser calling. Add them on the Twilio integration.',
      },
      { status: 400 },
    )
  }

  try {
    const { token, identity, expiresAt } = await generateVoiceToken({
      accountSid: creds.accountSid,
      apiKeySid: creds.apiKeySid,
      apiKeySecret: creds.apiKeySecret,
      twimlAppSid: creds.twimlAppSid,
      identity: settings.twilio_client_identity,
    })
    return Response.json({ token, identity, expiresAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 400 })
  }
}

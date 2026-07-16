// src/app/api/twilio/recording/route.ts
// Twilio Recording Status webhook (SEED-007).
// Fired by Twilio when a call recording is `completed`. Receives
//   RecordingUrl, RecordingSid, RecordingDuration, CallSid, AccountSid
//
// Pipeline:
//   1. Signature-validate against the org's auth_token (org resolved via CallSid)
//   2. Download the recording from Twilio and upload to Hetzner (env-gated)
//   3. Update call_logs.recording_url + recording_duration

import { after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyTwilioSignatureMultiUrl } from '@/lib/twilio/webhook-signature'
import { resolveTwilioCredentialsForOrg } from '@/lib/twilio/voice'
import { uploadRecordingToHetzner } from '@/lib/calls/upload-recording'
import { captureApiError } from '@/lib/api-error'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text()
    const params = new URLSearchParams(rawBody)

    const callSid = params.get('CallSid') ?? ''
    const recordingSid = params.get('RecordingSid') ?? ''
    const recordingUrl = params.get('RecordingUrl') ?? ''
    const recordingDuration = parseInt(params.get('RecordingDuration') ?? '0', 10)
    const recordingStatus = params.get('RecordingStatus') ?? ''

    if (!callSid || !recordingSid || !recordingUrl) {
      console.warn('[twilio/recording] Missing params | acking')
      return new Response('', { status: 200 })
    }

    // Resolve org via the existing call_log row (created by /voice webhook).
    const supabase = createServiceRoleClient()
    const { data: callLog } = await supabase
      .from('call_logs')
      .select('id, org_id')
      .eq('call_sid', callSid)
      .limit(1)
      .maybeSingle()

    if (!callLog) {
      // Recording may arrive before our call_logs row exists (rare race) |
      // store the raw URL keyed by call_sid for later reconciliation.
      console.warn('[twilio/recording] No call_log for CallSid yet:', callSid)
      return new Response('', { status: 200 })
    }

    const creds = await resolveTwilioCredentialsForOrg(callLog.org_id)
    if (!creds) {
      console.warn('[twilio/recording] No Twilio creds for org:', callLog.org_id)
      return new Response('', { status: 200 })
    }

    // Signature validation — multi-URL candidate verification (same as
    // /api/twilio/voice) so proxy URL-resolution mismatches don't 403 the
    // recording callback and silently drop the stored recording.
    const isValid = verifyTwilioSignatureMultiUrl(
      creds.authToken,
      request,
      params,
      request.headers.get('x-twilio-signature'),
    )
    if (!isValid) {
      console.warn('[twilio/recording] Invalid signature for CallSid:', callSid)
      return new Response('Forbidden', { status: 403 })
    }

    if (recordingStatus && recordingStatus !== 'completed') {
      // Twilio also fires 'in-progress' events | only persist the final one.
      return new Response('', { status: 200 })
    }

    // Async upload | return 200 immediately so Twilio doesn't retry on slow S3.
    after(async () => {
      try {
        const result = await uploadRecordingToHetzner({
          orgId: callLog.org_id,
          callSid,
          recordingSid,
          recordingUrl,
          recordingDuration,
          twilioAccountSid: creds.accountSid,
          twilioAuthToken: creds.authToken,
        })

        await supabase
          .from('call_logs')
          .update({
            recording_url: result.storedUrl,
            recording_duration: recordingDuration > 0 ? recordingDuration : null,
          })
          .eq('id', callLog.id)
      } catch (err) {
        console.error('[twilio/recording] upload error:', err)
        captureApiError(err)
      }
    })

    return new Response('', { status: 200 })
  } catch (err) {
    console.error('[twilio/recording] handler error:', err)
    captureApiError(err)
    return new Response('', { status: 200 })
  }
}

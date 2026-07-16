// src/app/api/twilio/sms/route.ts
// Twilio Inbound SMS webhook (SEED-005 | omnichannel inbox completion).
// Public URL: https://xphere.app/api/twilio/sms
//
// Auth: HMAC-SHA1 signature in the X-Twilio-Signature header (Twilio convention,
// NOT SHA256 like Meta). The signature covers: requestUrl + concat(sorted POST params).
// Twilio's auth token is the SAME credential used to send outbound SMS | we look up
// the org by the destination phone number (`To`), then validate the signature against
// that org's stored auth_token.
//
// Behaviour:
//   - Returns 403 only when signature validation fails AFTER successful org lookup.
//   - Returns 200 with empty `<Response/>` TwiML on every other path | even malformed
//     bodies, missing orgs, processing errors. This is mandatory: Twilio retries 4xx/5xx
//     aggressively and a bad webhook can wedge an entire SMS conversation.
//   - The inbound message is persisted before the 200 response. Slower
//     automation/agent reply work runs fire-and-forget after that critical write.

import { resolveTwilioOrgByToNumber } from '@/lib/twilio/voice'
import {
  continueTwilioSmsAutomation,
  ingestTwilioSms,
  type TwilioSmsPayload,
} from '@/lib/twilio/process-sms'
import { captureApiError } from '@/lib/api-error'
import { verifyTwilioSignatureMultiUrl } from '@/lib/twilio/webhook-signature'

export const runtime = 'nodejs'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const TWIML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' }

/**
 * Returns the 200 + empty TwiML response Twilio expects when we don't want
 * to send a reply inline (we send replies via the REST API from after()).
 */
function ackTwiml(): Response {
  return new Response(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS })
}

export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Read raw body as text so we can both parse params AND rebuild the signature base
    const rawBody = await request.text()
    let params: URLSearchParams
    try {
      params = new URLSearchParams(rawBody)
    } catch {
      console.warn('[twilio/sms] Unparseable form body | acking with empty TwiML')
      return ackTwiml()
    }

    const from = params.get('From') ?? ''
    const to = params.get('To') ?? ''
    const body = params.get('Body') ?? ''
    const messageSid = params.get('MessageSid') ?? params.get('SmsSid') ?? ''

    if (!to) {
      // No To number | cannot route to an org. Ack and drop.
      console.warn('[twilio/sms] Missing To parameter | dropping')
      return ackTwiml()
    }

    // 2. Resolve the org by destination number via twilio_phone_numbers.
    //    Returns phone_number_id used downstream by process-sms.
    const resolved = await resolveTwilioOrgByToNumber(to, params.get('AccountSid'))
    if (!resolved) {
      console.warn('[twilio/sms] No active Twilio integration found for To:', to)
      return ackTwiml()
    }
    const orgId = resolved.orgId
    const phoneNumberId = resolved.phoneNumberId
    const authToken = resolved.creds.authToken

    // 3. Validate the signature against the org's auth_token
    const receivedSignature = request.headers.get('x-twilio-signature')

    const isValid = verifyTwilioSignatureMultiUrl(authToken, request, params, receivedSignature)
    if (!isValid) {
      console.warn('[twilio/sms] Invalid X-Twilio-Signature for org:', orgId)
      return new Response('Forbidden', { status: 403 })
    }

    // 4. Persist the inbound message before the 200 response. Production
    // self-hosting can lose post-response work if the critical DB write is
    // deferred, so only the slower agent auto-reply path runs fire-and-forget
    // after ingestion.
    const payload: TwilioSmsPayload = {
      From: from,
      To: to,
      Body: body,
      MessageSid: messageSid,
      AccountSid: params.get('AccountSid') ?? undefined,
      NumMedia: params.get('NumMedia') ?? undefined,
      // MMS media fields (up to 10 attachments)
      MediaUrl0: params.get('MediaUrl0') ?? undefined,
      MediaUrl1: params.get('MediaUrl1') ?? undefined,
      MediaUrl2: params.get('MediaUrl2') ?? undefined,
      MediaUrl3: params.get('MediaUrl3') ?? undefined,
      MediaUrl4: params.get('MediaUrl4') ?? undefined,
      MediaUrl5: params.get('MediaUrl5') ?? undefined,
      MediaUrl6: params.get('MediaUrl6') ?? undefined,
      MediaUrl7: params.get('MediaUrl7') ?? undefined,
      MediaUrl8: params.get('MediaUrl8') ?? undefined,
      MediaUrl9: params.get('MediaUrl9') ?? undefined,
      MediaContentType0: params.get('MediaContentType0') ?? undefined,
      MediaContentType1: params.get('MediaContentType1') ?? undefined,
      MediaContentType2: params.get('MediaContentType2') ?? undefined,
      MediaContentType3: params.get('MediaContentType3') ?? undefined,
      MediaContentType4: params.get('MediaContentType4') ?? undefined,
      MediaContentType5: params.get('MediaContentType5') ?? undefined,
      MediaContentType6: params.get('MediaContentType6') ?? undefined,
      MediaContentType7: params.get('MediaContentType7') ?? undefined,
      MediaContentType8: params.get('MediaContentType8') ?? undefined,
      MediaContentType9: params.get('MediaContentType9') ?? undefined,
      // Pass credentials for media download (never stored | only used in after())
      _authToken: authToken,
    }

    const ingested = await ingestTwilioSms(payload, orgId, phoneNumberId)
    if (ingested) {
      void continueTwilioSmsAutomation(ingested).catch((err) => {
        console.error('[twilio/sms] continueTwilioSmsAutomation error:', err)
        captureApiError(err)
      })
    }

    return ackTwiml()
  } catch (err) {
    console.error('[twilio/sms] Outer handler error:', err)
    captureApiError(err)
    return ackTwiml()
  }
}

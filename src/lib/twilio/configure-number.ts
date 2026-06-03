const DEFAULT_PUBLIC_ORIGIN = 'https://xphere.app'

function webhookOrigin(): string {
  return (
    process.env.TWILIO_WEBHOOK_BASE_URL ??
    process.env.XPHERE_PUBLIC_ORIGIN ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    DEFAULT_PUBLIC_ORIGIN
  ).replace(/\/$/, '')
}

export function getTwilioSmsWebhookUrl(): string {
  return `${webhookOrigin()}/api/twilio/sms`
}

export function getTwilioVoiceWebhookUrl(): string {
  return `${webhookOrigin()}/api/twilio/voice`
}

export async function configureTwilioSmsWebhook(params: {
  accountSid: string
  authToken: string
  phoneSid: string
  smsUrl?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const smsUrl = params.smsUrl ?? getTwilioSmsWebhookUrl()
  const basicAuth = btoa(`${params.accountSid}:${params.authToken}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/IncomingPhoneNumbers/${params.phoneSid}.json`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        SmsUrl: smsUrl,
        SmsMethod: 'POST',
        // A TwiML App on the number can override the direct SmsUrl handler.
        // Clear it whenever Xphere owns inbound SMS routing for this number.
        SmsApplicationSid: '',
      }).toString(),
      cache: 'no-store',
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error contacting Twilio.' }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `Twilio responded ${res.status}: ${body.slice(0, 300)}` }
  }

  return { ok: true }
}

export async function configureTwilioVoiceWebhook(params: {
  accountSid: string
  authToken: string
  phoneSid: string
  voiceUrl?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const voiceUrl = params.voiceUrl ?? getTwilioVoiceWebhookUrl()
  const basicAuth = btoa(`${params.accountSid}:${params.authToken}`)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${params.accountSid}/IncomingPhoneNumbers/${params.phoneSid}.json`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        VoiceUrl: voiceUrl,
        VoiceMethod: 'POST',
        // A TwiML App bound to the number overrides the direct VoiceUrl, which
        // is how inbound calls silently bypass Xphere. Clear it so our inbound
        // webhook owns call routing for this number.
        VoiceApplicationSid: '',
      }).toString(),
      cache: 'no-store',
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error contacting Twilio.' }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `Twilio responded ${res.status}: ${body.slice(0, 300)}` }
  }

  return { ok: true }
}

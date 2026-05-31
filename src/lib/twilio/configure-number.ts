const DEFAULT_PUBLIC_ORIGIN = 'https://xphere.app'

export function getTwilioSmsWebhookUrl(): string {
  const origin =
    process.env.TWILIO_WEBHOOK_BASE_URL ??
    process.env.XPHERE_PUBLIC_ORIGIN ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    DEFAULT_PUBLIC_ORIGIN

  return `${origin.replace(/\/$/, '')}/api/twilio/sms`
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

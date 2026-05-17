// src/lib/twilio/access-token.ts
// Generates a Twilio Access Token with a VoiceGrant for the Voice SDK.
//
// Uses HMAC-SHA256 manually (Web Crypto) so we stay Edge-runtime safe and avoid
// pulling the full twilio-node SDK.
//
// Token shape (JWT):
//   header  : { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' }
//   payload : { jti, iss=apiKeySid, sub=accountSid, exp, grants:{ identity, voice:{...} } }
//
// Twilio docs:
//   https://www.twilio.com/docs/iam/access-tokens
//   https://www.twilio.com/docs/voice/sdks/javascript/get-started#generate-access-tokens
//
// In dev, where TWILIO_API_KEY_SID/SECRET aren't configured, generateVoiceToken
// throws — surface it as a 400 in /api/twilio/token so the UI shows a helpful
// banner explaining how to finish setup.

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const keyBytes = new TextEncoder().encode(key)
  const msgBytes = new TextEncoder().encode(message)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes)
  return new Uint8Array(sig)
}

export interface VoiceTokenParams {
  accountSid: string
  apiKeySid: string
  apiKeySecret: string
  twimlAppSid: string
  identity: string
  /** Token lifetime in seconds (max 24h, Twilio convention). Default: 1h. */
  ttlSeconds?: number
}

export async function generateVoiceToken(p: VoiceTokenParams): Promise<{ token: string; identity: string; expiresAt: number }> {
  if (!p.apiKeySid || !p.apiKeySecret) {
    throw new Error('Twilio API Key (TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET) is not configured. Add an API Key in the Twilio console and store it on the integration before generating Voice tokens.')
  }
  if (!p.twimlAppSid) {
    throw new Error('Twilio TwiML App SID is not configured on the integration. Create a TwiML App pointing at /api/twilio/voice and store its SID in the integration config (`twiml_app_sid`).')
  }

  const now = Math.floor(Date.now() / 1000)
  const ttl = Math.min(p.ttlSeconds ?? 3600, 24 * 3600)
  const expiresAt = now + ttl

  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' }
  const payload = {
    jti: `${p.apiKeySid}-${now}`,
    iss: p.apiKeySid,
    sub: p.accountSid,
    nbf: now,
    exp: expiresAt,
    grants: {
      identity: p.identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: p.twimlAppSid },
      },
    },
  }

  const encHeader = base64url(JSON.stringify(header))
  const encPayload = base64url(JSON.stringify(payload))
  const signingInput = `${encHeader}.${encPayload}`
  const sig = await hmacSha256(p.apiKeySecret, signingInput)
  const encSig = base64url(sig)

  return { token: `${signingInput}.${encSig}`, identity: p.identity, expiresAt }
}

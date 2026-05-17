// src/lib/twilio/webhook-signature.ts
// Shared Twilio signature verification for voice webhooks. Mirrors the inline
// implementation in /api/twilio/sms/route.ts so we have one place to fix if the
// algorithm ever changes.
//
// Twilio canonical string: URL + concat(sorted(key + value)) over POST params.
// Signature: HMAC-SHA1(authToken, canonical), base64-encoded.

import { createHmac, timingSafeEqual } from 'node:crypto'

export function buildTwilioSignatureBase(url: string, params: URLSearchParams): string {
  const sortedKeys = Array.from(new Set(Array.from(params.keys()))).sort()
  let canonical = url
  for (const key of sortedKeys) {
    for (const v of params.getAll(key)) canonical += key + v
  }
  return canonical
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
  receivedSignature: string | null,
): boolean {
  if (!receivedSignature || !authToken) return false
  const canonical = buildTwilioSignatureBase(url, params)
  const expected = createHmac('sha1', authToken).update(canonical, 'utf8').digest('base64')

  let bufA: Buffer
  let bufB: Buffer
  try {
    bufA = Buffer.from(expected, 'utf8')
    bufB = Buffer.from(receivedSignature, 'utf8')
  } catch {
    return false
  }
  if (bufA.length !== bufB.length) return false
  try {
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

/** Resolve the absolute URL Twilio used to call us, honoring proxy headers. */
export function resolveWebhookUrl(request: Request): string {
  const explicit = process.env.TWILIO_WEBHOOK_BASE_URL
  const url = new URL(request.url)
  if (explicit) {
    const base = explicit.replace(/\/$/, '')
    return `${base}${url.pathname}${url.search}`
  }
  const fwdProto = request.headers.get('x-forwarded-proto')
  const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (fwdProto && fwdHost) return `${fwdProto}://${fwdHost}${url.pathname}${url.search}`
  return request.url
}

/** Public base URL to use when constructing callback URLs in TwiML. */
export function publicBaseUrl(request: Request): string {
  const explicit = process.env.TWILIO_WEBHOOK_BASE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const fwdProto = request.headers.get('x-forwarded-proto')
  const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (fwdProto && fwdHost) return `${fwdProto}://${fwdHost}`
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

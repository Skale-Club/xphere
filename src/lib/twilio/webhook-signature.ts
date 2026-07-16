// src/lib/twilio/webhook-signature.ts
// Shared Twilio signature verification for all Twilio webhooks (sms, voice,
// voice/continue, status, recording). This is the single source of truth —
// no consumer should reimplement signature verification or URL-candidate
// resolution inline. All webhooks verify via `verifyTwilioSignatureMultiUrl`;
// the single-URL primitives are module-private implementation details.
//
// Twilio canonical string: URL + concat(sorted(key + value)) over POST params.
// Signature: HMAC-SHA1(authToken, canonical), base64-encoded.

import { createHmac, timingSafeEqual } from 'node:crypto'

function buildTwilioSignatureBase(url: string, params: URLSearchParams): string {
  const sortedKeys = Array.from(new Set(Array.from(params.keys()))).sort()
  let canonical = url
  for (const key of sortedKeys) {
    for (const v of params.getAll(key)) canonical += key + v
  }
  return canonical
}

/** Verify against ONE candidate URL. Internal — use verifyTwilioSignatureMultiUrl. */
function verifyTwilioSignature(
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

/**
 * Resolve every URL Twilio could plausibly have used to reach this webhook, in
 * priority order, de-duplicated. Self-hosting behind a proxy (Coolify) means
 * proto/host resolution isn't always consistent — a single "best guess"
 * candidate is fine for constructing NEW callback URLs (see publicBaseUrl)
 * but too brittle for verifying a signature Twilio computed against whatever
 * URL IT saw. Originally introduced in /api/twilio/sms (the voice webhooks
 * used a single-candidate resolver, which could 403 on requests SMS would
 * have accepted for the same proxy config) — moved here so every webhook
 * shares the same resilience.
 *
 * Order: explicit override → proxy-observed origin → runtime-resolved
 * request.url → alternate public-origin env vars → canonical prod origin.
 */
export function resolveWebhookUrlCandidates(request: Request): string[] {
  const url = new URL(request.url)
  const candidates: string[] = []

  const addBase = (base: string | undefined | null) => {
    if (!base) return
    candidates.push(`${base.replace(/\/$/, '')}${url.pathname}${url.search}`)
  }

  addBase(process.env.TWILIO_WEBHOOK_BASE_URL)

  const fwdProto = request.headers.get('x-forwarded-proto')
  const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (fwdProto && fwdHost) {
    candidates.push(`${fwdProto}://${fwdHost}${url.pathname}${url.search}`)
  }
  candidates.push(request.url)
  addBase(process.env.XPHERE_PUBLIC_ORIGIN)
  addBase(process.env.NEXT_PUBLIC_SITE_URL)
  addBase('https://xphere.app')

  return Array.from(new Set(candidates))
}

/**
 * Verify a Twilio signature by trying every URL candidate from
 * `resolveWebhookUrlCandidates` until one validates. This is THE verification
 * entry point for all Twilio webhooks — it tolerates proxy URL-resolution
 * mismatches that would cause a false-negative 403 with a single guessed URL.
 */
export function verifyTwilioSignatureMultiUrl(
  authToken: string,
  request: Request,
  params: URLSearchParams,
  receivedSignature: string | null,
): boolean {
  return resolveWebhookUrlCandidates(request).some((candidateUrl) =>
    verifyTwilioSignature(authToken, candidateUrl, params, receivedSignature),
  )
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

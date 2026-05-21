// src/app/api/meta/webhook/route.ts
// Meta Webhook Handler | GET for hub challenge verification, POST for event processing.
// Always returns HTTP 200 on valid requests (even if processing fails) to prevent Meta retry storms.
// HMAC-SHA256 signature verification is the ONLY reason to return 403 on POST.

import { after } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { processMetaEvent, type MetaWebhookPayload } from '@/lib/meta/process-event'

export const runtime = 'nodejs'

/**
 * Verifies the x-hub-signature-256 header against the raw body HMAC.
 * Must use timingSafeEqual to prevent timing-based side-channel attacks.
 * Returns false if META_APP_SECRET is not set (safe default).
 */
function verifyMetaSignature(rawBody: string, signature: string | null): boolean {
  if (!signature?.startsWith('sha256=')) return false
  const secret = process.env.META_APP_SECRET
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const received = signature.slice('sha256='.length)
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
  } catch {
    // Buffer.from can throw if received is not valid hex
    return false
  }
}

/**
 * GET /api/meta/webhook
 * Hub challenge verification | Meta sends this before activating the webhook subscription.
 * Returns the hub.challenge value verbatim when mode=subscribe and token matches.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

/**
 * POST /api/meta/webhook
 * Receives inbound Instagram DM and Messenger events from Meta.
 * 1. Reads raw body as text (BEFORE JSON.parse | required for HMAC to match)
 * 2. Verifies HMAC-SHA256 signature | returns 403 if invalid (only non-200 POST response)
 * 3. Parses JSON and dispatches processMetaEvent via after() so response returns immediately
 * 4. Returns 200 on all valid requests (even if processing fails)
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // CRITICAL: Read raw body BEFORE any JSON parsing | HMAC is over the original bytes
    const rawBody = await request.text()
    const signature = request.headers.get('x-hub-signature-256')

    if (!verifyMetaSignature(rawBody, signature)) {
      console.warn('[meta/webhook] Invalid or missing HMAC signature | request rejected')
      return new Response(null, { status: 403 })
    }

    let payload: MetaWebhookPayload
    try {
      payload = JSON.parse(rawBody) as MetaWebhookPayload
    } catch {
      console.warn('[meta/webhook] Malformed JSON body after valid HMAC | skipping processing')
      return Response.json({ ok: true })
    }

    // Schedule async processing AFTER the 200 response is sent | prevents Meta timeout/retry
    after(async () => {
      try {
        await processMetaEvent(payload)
      } catch (err) {
        console.error('[meta/webhook] processMetaEvent error:', err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[meta/webhook] Outer handler error:', err)
    return Response.json({ ok: true })
  }
}

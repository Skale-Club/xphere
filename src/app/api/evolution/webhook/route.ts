// src/app/api/evolution/webhook/route.ts
// Evolution Go webhook receiver — always returns HTTP 200.
//
// Evolution Go sends one POST per event (configured at instance create time).
// The instance name arrives either in the JSON body (`instance` field) or as
// a path/query parameter — we handle both. Signature validation is optional:
// if the instance has a configured webhook_secret, we verify a SHA-256 HMAC
// over the raw body (Evolution Go header: `x-webhook-signature`).
//
// Processing runs in after() so the response returns immediately, avoiding
// upstream retries on slow agent dispatch.

import { after } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { processEvolutionEvent, type EvolutionWebhookPayload } from '@/lib/evolution/process-event'
import { resolveEvolutionInstanceByName } from '@/lib/evolution/credentials'

export const runtime = 'nodejs'

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const stripped = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(stripped, 'hex'))
  } catch {
    return false
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text()

    let payload: EvolutionWebhookPayload
    try {
      payload = JSON.parse(rawBody) as EvolutionWebhookPayload
    } catch {
      console.warn('[evolution/webhook] malformed JSON body')
      return Response.json({ ok: true })
    }

    // Fallback: pull instance from query if not in body
    if (!payload.instance) {
      const url = new URL(request.url)
      const fromQuery = url.searchParams.get('instance') ?? request.headers.get('x-instance-name')
      if (fromQuery) payload.instance = fromQuery
    }

    if (!payload.instance) {
      console.warn('[evolution/webhook] missing instance name')
      return Response.json({ ok: true })
    }

    // Optional signature check — only enforced when instance has a secret configured
    const instance = await resolveEvolutionInstanceByName(payload.instance)
    if (instance?.webhookSecret) {
      const sig =
        request.headers.get('x-webhook-signature') ??
        request.headers.get('x-hub-signature-256')
      if (!verifySignature(rawBody, sig, instance.webhookSecret)) {
        console.warn('[evolution/webhook] invalid signature for instance:', payload.instance)
        // Still return 200 — we just won't process. Evolution Go would otherwise retry forever.
        return Response.json({ ok: true })
      }
    }

    after(async () => {
      try {
        await processEvolutionEvent(payload)
      } catch (err) {
        console.error('[evolution/webhook] processEvolutionEvent error:', err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[evolution/webhook] outer handler error:', err)
    return Response.json({ ok: true })
  }
}

// Some Evolution Go deployments verify the webhook with a GET request first.
export async function GET(): Promise<Response> {
  return Response.json({ ok: true, service: 'operator-evolution-webhook' })
}

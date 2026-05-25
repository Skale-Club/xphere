// src/app/api/wapi/webhook/route.ts
// W-API webhook receiver | always returns HTTP 200.

import { after } from 'next/server'
import {
  normalizeWApi,
  wapiAdapter,
  type WApiWebhookPayload,
} from '@/lib/whatsapp/adapters/wapi'
import { processWhatsAppMessage } from '@/lib/whatsapp/process-message'
import { resolveProviderByWApiKey } from '@/lib/whatsapp/resolve-provider'
import { verifySharedSecret } from '@/lib/webhooks/verify-shared-secret'

export const runtime = 'nodejs'

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text()
    let payload: WApiWebhookPayload
    try {
      payload = JSON.parse(rawBody) as WApiWebhookPayload
    } catch {
      console.warn('[wapi/webhook] malformed JSON body')
      return Response.json({ ok: true })
    }

    const url = new URL(request.url)
    const instanceKey =
      url.searchParams.get('instance') ??
      url.searchParams.get('instance_key') ??
      payload.instance_key ??
      null

    if (!instanceKey) {
      console.warn('[wapi/webhook] missing instance_key')
      return Response.json({ ok: true })
    }

    const provider = await resolveProviderByWApiKey(instanceKey)
    if (!provider) {
      console.warn('[wapi/webhook] no provider for instance_key:', instanceKey)
      return Response.json({ ok: true })
    }

    // Required auth: W-API supports a shared-secret header. Prefer the
    // dedicated webhook_secret column; fall back to provider.config.token.
    // Fail-closed if neither side has a configured secret or values differ.
    const sentToken =
      request.headers.get('x-wapi-token') ?? request.headers.get('x-w-api-token')
    const expectedToken = provider.webhookSecret ?? provider.config.token ?? ''
    const verdict = verifySharedSecret(sentToken, expectedToken)
    if (verdict !== 'ok') {
      console.warn('[wapi/webhook]', verdict, 'for instance_key:', instanceKey)
      return forbidden()
    }

    after(async () => {
      try {
        const messages = normalizeWApi(payload, provider)
        for (const m of messages) {
          await processWhatsAppMessage(m, provider, wapiAdapter)
        }
      } catch (err) {
        console.error('[wapi/webhook] processing error:', err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[wapi/webhook] outer handler error:', err)
    return Response.json({ ok: true })
  }
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, service: 'operator-wapi-webhook' })
}

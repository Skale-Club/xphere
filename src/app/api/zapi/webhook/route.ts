// src/app/api/zapi/webhook/route.ts
// Z-API webhook receiver | always returns HTTP 200.
// Configure in Z-API panel: "Webhook ao Receber" → https://xphere.app/api/zapi/webhook?instance={instanceId}

import { after } from 'next/server'
import {
  normalizeZApi,
  zapiAdapter,
  type ZApiWebhookPayload,
} from '@/lib/whatsapp/adapters/zapi'
import { processWhatsAppMessage } from '@/lib/whatsapp/process-message'
import { resolveProviderByZApiInstance } from '@/lib/whatsapp/resolve-provider'
import { verifySharedSecret } from '@/lib/webhooks/verify-shared-secret'
import { captureApiError } from '@/lib/api-error'

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
    let payload: ZApiWebhookPayload
    try {
      payload = JSON.parse(rawBody) as ZApiWebhookPayload
    } catch {
      console.warn('[zapi/webhook] malformed JSON body')
      return Response.json({ ok: true })
    }

    const url = new URL(request.url)
    const instanceId =
      url.searchParams.get('instance') ??
      url.searchParams.get('instanceId') ??
      payload.instanceId ??
      null

    if (!instanceId) {
      console.warn('[zapi/webhook] missing instanceId')
      return Response.json({ ok: true })
    }

    const provider = await resolveProviderByZApiInstance(instanceId)
    if (!provider) {
      console.warn('[zapi/webhook] no provider for instanceId:', instanceId)
      return Response.json({ ok: true })
    }

    // Required auth: Z-API sends Client-Token header on every webhook.
    // Prefer the dedicated webhook_secret column; fall back to the provider's
    // API token in config for orgs that have not split the two yet. Either way,
    // a secret MUST be configured server-side and MUST match what Z-API sent,
    // otherwise reject. Timing-safe compare.
    const sentToken = request.headers.get('x-z-api-token')
    const expectedToken = provider.webhookSecret ?? provider.config.token ?? ''
    const verdict = verifySharedSecret(sentToken, expectedToken)
    if (verdict !== 'ok') {
      console.warn('[zapi/webhook]', verdict, 'for instanceId:', instanceId)
      return forbidden()
    }

    after(async () => {
      try {
        const messages = normalizeZApi(payload, provider)
        for (const m of messages) {
          await processWhatsAppMessage(m, provider, zapiAdapter)
        }
      } catch (err) {
        console.error('[zapi/webhook] processing error:', err)
        captureApiError(err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[zapi/webhook] outer handler error:', err)
    captureApiError(err)
    return Response.json({ ok: true })
  }
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, service: 'operator-zapi-webhook' })
}

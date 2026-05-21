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

export const runtime = 'nodejs'

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

    // Optional auth: Z-API sends Client-Token header on every webhook
    const sentToken = request.headers.get('x-z-api-token')
    if (sentToken && provider.config.token && sentToken !== provider.config.token) {
      console.warn('[zapi/webhook] token mismatch for instanceId:', instanceId)
      return Response.json({ ok: true })
    }

    after(async () => {
      try {
        const messages = normalizeZApi(payload, provider)
        for (const m of messages) {
          await processWhatsAppMessage(m, provider, zapiAdapter)
        }
      } catch (err) {
        console.error('[zapi/webhook] processing error:', err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[zapi/webhook] outer handler error:', err)
    return Response.json({ ok: true })
  }
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, service: 'operator-zapi-webhook' })
}

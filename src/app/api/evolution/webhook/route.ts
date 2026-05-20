// src/app/api/evolution/webhook/route.ts
// Evolution Go webhook receiver — always returns HTTP 200.
//
// SEED-031: refactored to use the unified WhatsApp pipeline. For
// messages.upsert, payloads are normalized via the Evolution adapter and
// dispatched through processWhatsAppMessage. connection.update still updates
// the legacy evolution_instances row when present.

import { after } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  evolutionAdapter,
  normalizeEvolution,
  type EvolutionWebhookPayload,
} from '@/lib/whatsapp/adapters/evolution'
import { processWhatsAppMessage } from '@/lib/whatsapp/process-message'
import { resolveProviderByInstanceName } from '@/lib/whatsapp/resolve-provider'

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

interface ConnectionUpdateData {
  state?: string
  instance?: { state?: string; wuid?: string }
  wuid?: string
}

function jidToPhone(jid: string): string {
  const num = jid.split('@')[0]
  if (!num) return jid
  return num.startsWith('+') ? num : `+${num}`
}

async function handleConnectionUpdate(payload: EvolutionWebhookPayload): Promise<void> {
  const data = payload.data as ConnectionUpdateData
  const rawState = data?.state ?? data?.instance?.state ?? ''
  let status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending' = 'disconnected'
  if (rawState === 'open') status = 'connected'
  else if (rawState === 'qr') status = 'qr_pending'
  else if (rawState === 'connecting') status = 'connecting'

  let phone: string | null = null
  const wuid = data?.instance?.wuid ?? data?.wuid
  if (typeof wuid === 'string' && wuid.length > 0) {
    phone = jidToPhone(wuid)
  }

  const supabase = createServiceRoleClient()

  // Update the unified row if it exists
  const resolved = await resolveProviderByInstanceName(payload.instance)
  if (resolved) {
    const update: Record<string, unknown> = { status }
    if (status === 'connected') {
      update.connected_at = new Date().toISOString()
      update.last_error = null
      if (phone) update.phone_number = phone
    }
    // Update whatsapp_providers when row exists there; fall back to legacy table
    const { data: wp } = await supabase
      .from('whatsapp_providers')
      .select('id')
      .eq('id', resolved.id)
      .maybeSingle()
    if (wp) {
      await supabase.from('whatsapp_providers').update(update).eq('id', resolved.id)
    } else {
      await supabase.from('evolution_instances').update(update).eq('id', resolved.id)
    }
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

    if (!payload.instance) {
      const url = new URL(request.url)
      const fromQuery = url.searchParams.get('instance') ?? request.headers.get('x-instance-name')
      if (fromQuery) payload.instance = fromQuery
    }
    if (!payload.instance) {
      console.warn('[evolution/webhook] missing instance name')
      return Response.json({ ok: true })
    }

    const provider = await resolveProviderByInstanceName(payload.instance)
    if (provider?.webhookSecret) {
      const sig =
        request.headers.get('x-webhook-signature') ??
        request.headers.get('x-hub-signature-256')
      if (!verifySignature(rawBody, sig, provider.webhookSecret)) {
        console.warn('[evolution/webhook] invalid signature for instance:', payload.instance)
        return Response.json({ ok: true })
      }
    }

    after(async () => {
      try {
        const eventType = (payload.event ?? '').toLowerCase()
        if (eventType === 'messages.upsert' || eventType === 'messages_upsert') {
          if (!provider) {
            console.warn('[evolution/webhook] no provider for instance:', payload.instance)
            return
          }
          const messages = normalizeEvolution(payload, provider)
          for (const m of messages) {
            await processWhatsAppMessage(m, provider, evolutionAdapter)
          }
          return
        }
        if (eventType === 'connection.update' || eventType === 'connection_update') {
          await handleConnectionUpdate(payload)
        }
      } catch (err) {
        console.error('[evolution/webhook] processing error:', err)
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

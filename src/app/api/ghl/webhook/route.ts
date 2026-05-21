// src/app/api/ghl/webhook/route.ts
// GHL Inbound Webhook | receives Customer Replied events from GoHighLevel.
// Always returns HTTP 200 on valid requests to prevent GHL retry storms.
//
// Auth: X-Operator-Secret header (per-location secret stored in ghl_channels).
// Route by locationId: GHL always includes locationId in the payload body.
//
// GHL Workflow setup:
//   Trigger:  Customer Replied (or Inbound Message)
//   Action:   Webhook → POST https://xphere.app/api/ghl/webhook
//   Headers:  X-Operator-Secret: <your webhook_secret from Operator>
//   Body:     default GHL payload (includes type, locationId, contactId, body, etc.)

import { after } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { processGhlEvent, type GhlWebhookPayload } from '@/lib/ghl/process-event'

export const runtime = 'nodejs'

function secretsMatch(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8')
    const bufB = Buffer.from(b, 'utf8')
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const secretHeader = request.headers.get('x-operator-secret') ?? ''

    let payload: GhlWebhookPayload
    try {
      payload = (await request.json()) as GhlWebhookPayload
    } catch {
      return Response.json({ ok: true })
    }

    const locationId = payload.locationId
    if (!locationId) {
      console.warn('[ghl/webhook] Missing locationId in payload | skipping')
      return Response.json({ ok: true })
    }

    // Resolve org and validate secret | use service role (no user session on webhooks)
    const supabase = createServiceRoleClient()
    const { data: ghlChannel } = await supabase
      .from('ghl_channels')
      .select('org_id, webhook_secret')
      .eq('location_id', locationId)
      .eq('is_active', true)
      .maybeSingle()

    if (!ghlChannel) {
      console.warn('[ghl/webhook] No active channel for locationId:', locationId)
      return Response.json({ ok: true })
    }

    if (!secretsMatch(secretHeader, ghlChannel.webhook_secret)) {
      console.warn('[ghl/webhook] Invalid X-Operator-Secret for location:', locationId)
      return new Response(null, { status: 403 })
    }

    const orgId = ghlChannel.org_id

    after(async () => {
      try {
        await processGhlEvent(payload, orgId)
      } catch (err) {
        console.error('[ghl/webhook] processGhlEvent error:', err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[ghl/webhook] Outer handler error:', err)
    return Response.json({ ok: true })
  }
}

// src/app/api/zernio/webhook/route.ts
// Zernio Webhook Handler | receives push events for inbound DMs and comments.
// Always returns HTTP 200 on valid requests to prevent Zernio retry storms.
// HMAC-SHA256 signature verification is the ONLY reason to return 403.
//
// Routing: each org registers its webhook as /api/zernio/webhook?t={webhook_token}
// The token (opaque UUID) maps to the org's integration row (integrations.config.webhook_token).

import { after } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { processZernioEvent, type ZernioWebhookPayload } from '@/lib/zernio/process-event'
import { captureApiError } from '@/lib/api-error'

export const runtime = 'nodejs'

/**
 * Verifies the X-Zernio-Signature header (HMAC-SHA256 of raw body).
 * Returns false if secret is absent or signature is missing/invalid.
 */
function verifyZernioSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-zernio-signature') ?? request.headers.get('x-late-signature')

    // 1. Extract routing token from query string
    const url = new URL(request.url)
    const webhookToken = url.searchParams.get('t')

    if (!webhookToken) {
      console.warn('[zernio/webhook] Missing routing token')
      return new Response(null, { status: 403 })
    }

    // 2. Look up the integration by webhook_token stored in config
    const supabase = createServiceRoleClient()
    const { data: integration } = await supabase
      .from('integrations')
      .select('organization_id, config')
      .eq('provider', 'zernio')
      .eq('is_active', true)
      .filter('config->>webhook_token', 'eq', webhookToken)
      .maybeSingle()

    if (!integration) {
      console.warn('[zernio/webhook] No integration found for token:', webhookToken)
      return new Response(null, { status: 403 })
    }

    const config = integration.config as Record<string, string> | null
    const webhookSecret = config?.webhook_secret ?? ''

    // 3. Verify HMAC signature
    if (webhookSecret && !verifyZernioSignature(rawBody, signature, webhookSecret)) {
      console.warn('[zernio/webhook] Invalid HMAC signature')
      return new Response(null, { status: 403 })
    }

    // 4. Parse payload
    let payload: ZernioWebhookPayload
    try {
      payload = JSON.parse(rawBody) as ZernioWebhookPayload
    } catch {
      console.warn('[zernio/webhook] Malformed JSON body')
      return Response.json({ ok: true })
    }

    const orgId = integration.organization_id

    // 5. Process asynchronously after response is sent (prevents Zernio timeout/retry)
    after(async () => {
      try {
        await processZernioEvent(payload, orgId)
      } catch (err) {
        console.error('[zernio/webhook] processZernioEvent error:', err)
        captureApiError(err)
      }
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[zernio/webhook] Outer handler error:', err)
    captureApiError(err)
    return Response.json({ ok: true })
  }
}

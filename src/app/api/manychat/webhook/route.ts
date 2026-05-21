// src/app/api/manychat/webhook/route.ts
// ManyChat External Request receiver.
// Auth: X-Operator-Secret header verified against manychat_channels.webhook_secret.
// Returns HTTP 403 before secret validation passes; always HTTP 200 after | even
// if JSON parse, DB insert, or dispatch fails. This prevents ManyChat retry storms
// once the caller has been authenticated.
//
// org_id is resolved from the channel row, NEVER from the request body.
//
// Phase 23: After insert, dispatch inline. dispatchManychatEvent finds a matching
// rule (if any), runs the bound action via the existing action engine, logs to
// action_logs, and updates the manychat_events row with the final status +
// action_log_id link. The dispatcher contract guarantees no throw | but the outer
// try/catch is preserved as defense-in-depth.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { dispatchManychatEvent } from '@/lib/manychat/dispatch-event'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const supabase = createServiceRoleClient()

  // --- Secret verification gate ---
  const secret = request.headers.get('x-operator-secret')

  const { data: channel } = await supabase
    .from('manychat_channels')
    .select('id, org_id')
    .eq('webhook_secret', secret ?? '')
    .eq('is_active', true)
    .maybeSingle()

  if (!channel) {
    // Invalid or missing secret | reject before any processing
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // --- After this point: always return 200 (prevents ManyChat retry storms) ---
  try {
    // Parse body | fall back to empty object on malformed JSON
    let body: Record<string, unknown> = {}
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      // Malformed JSON | log with unknown event_type, continue
    }

    const eventType =
      typeof body.event_type === 'string' && body.event_type.length > 0
        ? body.event_type
        : 'unknown'

    // Insert event | service role bypasses RLS (no user session in webhook context).
    // org_id resolved from channel lookup | NEVER from request body.
    // .select('id').single() captures the inserted UUID for the dispatcher (ROUTING-04).
    const { data: inserted } = await supabase
      .from('manychat_events')
      .insert({
        org_id: channel.org_id,
        channel_id: channel.id,
        event_type: eventType,
        event_payload: body as Json,
        status: 'unmatched',
      })
      .select('id')
      .single()

    // Phase 23 dispatch: only run if we got an event id back.
    // dispatchManychatEvent never throws | it captures all errors internally and
    // updates the event row to status='error' on failure.
    if (inserted?.id) {
      await dispatchManychatEvent(
        {
          eventId: inserted.id,
          orgId: channel.org_id,
          channelId: channel.id,
          eventType,
          payload: body,
        },
        supabase
      )
    }
  } catch {
    // Swallow all errors after secret validation | never expose internals
  }

  return Response.json({ ok: true })
}

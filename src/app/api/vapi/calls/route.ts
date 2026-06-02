// src/app/api/vapi/calls/route.ts
// Node.js Route Handler | receives Vapi end-of-call-report webhook after a call ends.
// No 500ms constraint | Vapi fires and forgets. Write synchronously, always return 200.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { VapiEndOfCallMessageSchema } from '@/types/vapi'
import { verifyVapiSecret } from '@/lib/vapi/verify-signature'
import { insertNotification } from '@/lib/notifications/insert'
import { log } from '@/lib/logger'
import { createLogger } from '@/lib/obs/logger'

export const runtime = 'nodejs'

const obs = createLogger({ route: 'api/vapi/calls' })

export async function POST(request: Request): Promise<Response> {
  const webhookStart = Date.now()
  void log({
    event_type: 'webhook.received',
    source: 'vapi-webhook',
    severity: 'info',
    status: 'ok',
    actor_type: 'webhook',
    payload: { endpoint: '/api/vapi/calls' },
  })

  try {
    if (!verifyVapiSecret(request)) {
      obs.warn('vapi_secret_rejected')
      void log({
        event_type: 'webhook.rejected',
        source: 'vapi-webhook',
        severity: 'warn',
        status: 'failed',
        actor_type: 'webhook',
        error_message: 'Invalid or missing X-Vapi-Secret',
        duration_ms: Date.now() - webhookStart,
        payload: { endpoint: '/api/vapi/calls' },
      })
      return new Response(null, { status: 200 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response(null, { status: 200 })
    }

    const parsed = VapiEndOfCallMessageSchema.safeParse(body)
    if (!parsed.success || parsed.data.message.type !== 'end-of-call-report') {
      return new Response(null, { status: 200 })
    }

    const { call, artifact, analysis, startedAt, endedAt, cost, endedReason } = parsed.data.message

    const vapiCallId = call?.id
    if (!vapiCallId) {
      obs.warn('vapi_missing_call_id')
      return new Response(null, { status: 200 })
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // Resolve org via assistant mapping
    let organizationId: string | null = null
    if (call?.assistantId) {
      const { data: mapping } = await supabase
        .from('assistant_mappings')
        .select('organization_id')
        .eq('vapi_assistant_id', call.assistantId)
        .eq('is_active', true)
        .limit(1)
        .single()
      organizationId = mapping?.organization_id ?? null
    }

    if (!organizationId) {
      obs.warn('vapi_no_assistant_mapping', { assistantId: call?.assistantId })
      return new Response(null, { status: 200 })
    }

    const { error } = await supabase.from('calls').insert({
      organization_id: organizationId,
      vapi_call_id: vapiCallId,
      assistant_id: call?.assistantId ?? null,
      call_type: call?.type ?? null,
      status: call?.status ?? null,
      ended_reason: endedReason ?? null,
      started_at: startedAt ?? call?.startedAt ?? null,
      ended_at: endedAt ?? call?.endedAt ?? null,
      cost: cost ?? call?.cost ?? null,
      customer_number: call?.customer?.number ?? null,
      customer_name: call?.customer?.name ?? null,
      summary: analysis?.summary ?? null,
      transcript: artifact?.transcript ?? null,
      transcript_turns: (artifact?.messages ?? []) as import('@/types/database').Json,
    })

    if (error) {
      // Duplicate vapi_call_id | idempotent: Vapi may retry, ignore unique constraint violations
      if (error.code !== '23505') {
        obs.error('vapi_calls_insert_error', { error: error.message })
        void log({
          event_type: 'call.ingested',
          source: 'vapi-webhook',
          severity: 'error',
          status: 'failed',
          org_id: organizationId,
          actor_type: 'webhook',
          actor_id: vapiCallId,
          error_message: error.message,
          duration_ms: Date.now() - webhookStart,
          payload: { vapi_call_id: vapiCallId, ended_reason: endedReason },
        })
      }
    } else {
      void log({
        event_type: 'call.ingested',
        source: 'vapi-webhook',
        severity: 'info',
        status: 'ok',
        org_id: organizationId,
        actor_type: 'webhook',
        actor_id: vapiCallId,
        duration_ms: Date.now() - webhookStart,
        payload: {
          vapi_call_id: vapiCallId,
          ended_reason: endedReason,
          call_type: call?.type ?? null,
        },
      })
    }

    // Emit missed_call notification for unanswered calls (NOTIF-04)
    const missedCallReasons = ['no-answer', 'customer-did-not-answer']
    if (!error && endedReason && missedCallReasons.includes(endedReason)) {
      await insertNotification(organizationId, 'missed_call', {
        call_log_id: vapiCallId,
        customer_number: call?.customer?.number ?? null,
      })
    }

    return new Response(null, { status: 200 })
  } catch (err) {
    obs.error('vapi_calls_unexpected_error', { error: err })
    return new Response(null, { status: 200 })
  }
}

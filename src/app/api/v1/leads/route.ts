import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyApiKey } from '@/lib/api-keys/verify'
import { ingestLead, LeadIngestionConflictError } from '@/lib/leads/ingest'
import { leadIngestionSchema } from '@/lib/leads/ingestion-schema'
import { emitLeadCaptured } from '@/lib/leads/events'
import { emitContactEvent } from '@/lib/contacts/events'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 64 * 1024

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Request body is too large', code: 'payload_too_large' }, { status: 413 })
  }

  const supabase = createServiceRoleClient()
  const auth = await verifyApiKey(request, supabase, 'leads:write')
  if (!auth.ok) {
    return Response.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  let payload: z.infer<typeof leadIngestionSchema>
  try {
    const rawText = await request.text()
    if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: 'Request body is too large', code: 'payload_too_large' }, { status: 413 })
    }
    payload = leadIngestionSchema.parse(JSON.parse(rawText))
  } catch (error) {
    return Response.json(
      { error: 'Invalid request body', code: 'invalid_payload', details: error instanceof z.ZodError ? error.errors : undefined },
      { status: 422 },
    )
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey !== payload.event_id) {
    return Response.json(
      { error: 'Idempotency-Key must match event_id', code: 'invalid_idempotency_key' },
      { status: 422 },
    )
  }

  try {
    const result = await ingestLead(supabase, auth.key.orgId, payload)
    if (result.eventAction === 'accepted') {
      if (result.contactAction === 'created') {
        await emitContactEvent(auth.key.orgId, 'contact.created', result.contactId, { supabase })
      }
      await emitLeadCaptured(supabase, auth.key.orgId, result.receiptId, result.contactId, payload)
    }
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', auth.key.keyId)
    return Response.json(
      {
        receipt_id: result.receiptId,
        contact_id: result.contactId,
        contact_action: result.contactAction,
        event_action: result.eventAction,
      },
      { status: result.eventAction === 'accepted' ? 201 : 200 },
    )
  } catch (error) {
    if (error instanceof LeadIngestionConflictError) {
      return Response.json({ error: error.message, code: 'idempotency_conflict' }, { status: 409 })
    }
    console.error('[api/v1/leads] ingestion failed', error instanceof Error ? error.message : 'unknown error')
    return Response.json({ error: 'Failed to ingest lead', code: 'ingestion_failed' }, { status: 500 })
  }
}

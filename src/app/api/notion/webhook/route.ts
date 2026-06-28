import { after } from 'next/server'

import { processNextGlobalKnowledgeSyncJob } from '@/lib/knowledge/notion-sync'
import { verifyNotionWebhookSignature } from '@/lib/notion/webhook'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

type NotionWebhookEvent = {
  id: string
  workspace_id: string
  type: string
  entity?: { id?: string; type?: string }
}

const DELETE_EVENTS = new Set(['page.deleted'])
const MAX_WEBHOOK_BYTES = 1024 * 1024
const SYNC_EVENTS = new Set([
  'page.created',
  'page.content_updated',
  'page.properties_updated',
  'page.moved',
  'page.undeleted',
  'data_source.content_updated',
  'data_source.created',
  'data_source.deleted',
  'data_source.moved',
  'data_source.schema_updated',
  'data_source.undeleted',
])

async function readLimitedBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_WEBHOOK_BYTES) return null
  if (!request.body) return ''

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let body = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_WEBHOOK_BYTES) {
      await reader.cancel()
      return null
    }
    body += decoder.decode(value, { stream: true })
  }
  return body + decoder.decode()
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await readLimitedBody(request)
  if (rawBody === null) return Response.json({ ok: true })
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return Response.json({ ok: true })
  }

  // One-time subscription verification is completed in the Notion developer
  // portal. Broadcast it to an operator's ephemeral Postgres LISTEN session;
  // never log or persist the plaintext token.
  if (typeof payload.verification_token === 'string') {
    const supabase = createServiceRoleClient()
    const { error } = await supabase.rpc(
      'broadcast_global_knowledge_webhook_verification',
      { p_verification_token: payload.verification_token },
    )
    if (error) {
      console.error('[notion/webhook] failed to broadcast verification token')
    }
    return Response.json({ ok: true, verification_received: true })
  }

  const verificationToken = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN
  if (!verificationToken) {
    console.error('[notion/webhook] NOTION_WEBHOOK_VERIFICATION_TOKEN is not configured')
    return Response.json({ ok: true })
  }
  const trusted = await verifyNotionWebhookSignature(
    rawBody,
    request.headers.get('x-notion-signature'),
    verificationToken,
  )
  if (!trusted) return Response.json({ ok: true })

  const event = payload as unknown as NotionWebhookEvent
  if (!event.id || !event.workspace_id || (!SYNC_EVENTS.has(event.type) && !DELETE_EVENTS.has(event.type))) {
    return Response.json({ ok: true })
  }

  const supabase = createServiceRoleClient()
  const { data: connection } = await supabase
    .from('global_knowledge_notion_connections')
    .select('id')
    .eq('workspace_id', event.workspace_id)
    .neq('status', 'disconnected')
    .maybeSingle()
  if (!connection) return Response.json({ ok: true })

  const { data: roots } = await supabase
    .from('global_knowledge_notion_roots')
    .select('id')
    .eq('connection_id', connection.id)
    .neq('status', 'disconnected')

  const entityId = event.entity?.id ?? null
  for (const root of roots ?? []) {
    const { error } = await supabase.from('global_knowledge_sync_jobs').insert({
      event_id: `${event.id}:${root.id}`,
      connection_id: connection.id,
      root_id: root.id,
      notion_page_id: entityId,
      // Reconcile from the current root state even for delete events. Notion
      // events may arrive out of order; a blind delete could otherwise win
      // after a later undelete/update event.
      job_type: 'reconcile',
      payload: { event_type: event.type },
    })
    if (error && error.code !== '23505') {
      console.error('[notion/webhook] failed to enqueue event:', error.message)
    }
  }

  after(async () => {
    try {
      await processNextGlobalKnowledgeSyncJob()
    } catch (error) {
      console.error('[notion/webhook] immediate worker failed:', error)
    }
  })
  return Response.json({ ok: true })
}

// POST /api/integrations/xpot/visits
// Inbound webhook receiver for Xpot field-visit outcomes.
//
// Xpot is configured (per Xphere workspace) to POST visit results here with the
// workspace's Xphere API key as the Bearer token. Each visit is appended to the
// matching prospect's timeline and stamps last_visit_at. A positive outcome can
// nudge engagement, but never auto-promotes lifecycle_stage.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveApiKey } from '@/lib/api-keys/verify'
import { resolveProspectEntity } from '@/lib/prospects/events'

export const runtime = 'nodejs'

// Map an Xpot visit outcome onto a prospect engagement_status, where meaningful.
function engagementForOutcome(outcome: string | null): string | null {
  const o = (outcome || '').toLowerCase()
  if (!o) return null
  if (o.includes('not_interested') || o.includes('not interested')) return 'not_interested'
  if (o.includes('interested')) return 'interested'
  if (o.includes('follow')) return 'needs_follow_up'
  if (o.includes('sale')) return 'engaged'
  return null
}

export async function POST(request: Request): Promise<Response> {
  const supabase = createServiceRoleClient()

  const key = await resolveApiKey(request, supabase)
  if (!key) return Response.json({ error: 'Invalid or missing API key' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data = (body.data as Record<string, unknown>) ?? body
  const xphereId = (data.xphere_id as string) ?? (data.xphereId as string) ?? null
  const xphereKind = (data.xphere_kind as string) ?? (data.xphereKind as string) ?? null
  const email = (data.email as string) ?? null

  const ref = await resolveProspectEntity(supabase, key.orgId, { xphereId, xphereKind, email })
  if (!ref) return Response.json({ ok: true, ignored: 'no_match' })

  const outcome = (data.outcome as string) ?? null
  const summary = (data.summary as string) ?? null
  const sentiment = (data.sentiment as string) ?? null
  const occurredAt = (data.occurred_at as string) ?? new Date().toISOString()

  await supabase.from('prospect_engagement_events').insert({
    org_id: key.orgId,
    entity_type: ref.entityType,
    entity_id: ref.entityId,
    event_type: 'visit',
    channel: 'visit',
    source_platform: 'xpot',
    occurred_at: occurredAt,
    payload: { outcome, summary, sentiment },
  })

  const table = ref.entityType === 'account' ? 'accounts' : 'contacts'
  const patch: Record<string, unknown> = { last_visit_at: occurredAt, updated_at: new Date().toISOString() }
  const engagement = engagementForOutcome(outcome)
  if (engagement) patch.engagement_status = engagement
  await supabase.from(table).update(patch).eq('id', ref.entityId).eq('org_id', key.orgId)

  return Response.json({ ok: true })
}

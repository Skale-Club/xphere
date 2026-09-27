// Ads Control Plane — act on every pending change of a batch.
//
//   POST /api/ads/changes/batches/:batchId { action: 'approve' | 'cancel', reason? }
//
// Each change keeps its own policy check, conflict check and verification;
// the response lists the outcome per change.

import { NextRequest } from 'next/server'
import { z } from 'zod'

import { dashboardActor } from '@/lib/ads/commands/actors'
import { approveBatch, cancelChange, listChanges } from '@/lib/ads/commands/engine'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
// A batch approves sequentially against the platform APIs.
export const maxDuration = 300

const BodySchema = z.object({
  action: z.enum(['approve', 'cancel']),
  reason: z.string().max(500).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }): Promise<Response> {
  const actor = await dashboardActor()
  if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!actor.canManage) return Response.json({ error: 'You do not have permission to manage ads.' }, { status: 403 })
  const { batchId } = await params
  if (!z.string().uuid().safeParse(batchId).success) return Response.json({ error: 'Invalid batch id' }, { status: 400 })

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

  let raw: unknown
  try { raw = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  if (parsed.data.action === 'approve') {
    const { results } = await approveBatch({ orgId: orgId as string, batchId, actor })
    return Response.json({
      total: results.length,
      applied: results.filter((r) => r.ok).length,
      results: results.map((r) =>
        r.ok ? { ok: true, change: r.change } : { ok: false, change_id: r.change_id, code: r.code, error: r.message },
      ),
    })
  }

  const pending = await listChanges(orgId as string, { batchId, status: ['awaiting_approval', 'queued'], limit: 200 })
  const results = []
  for (const change of pending) {
    const r = await cancelChange({ orgId: orgId as string, changeId: change.id, actor, reason: parsed.data.reason })
    results.push(r.ok ? { ok: true, change_id: change.id } : { ok: false, change_id: change.id, code: r.code, error: r.message })
  }
  return Response.json({ total: results.length, cancelled: results.filter((r) => r.ok).length, results })
}

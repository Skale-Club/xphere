// Ads Control Plane — one change request.
//
//   GET  /api/ads/changes/:id                        detail + event log
//   POST /api/ads/changes/:id { action: 'approve' | 'cancel' | 'rollback' | 'retry', reason? }

import { NextRequest } from 'next/server'
import { z } from 'zod'

import { dashboardActor } from '@/lib/ads/commands/actors'
import { approveChange, cancelChange, getChange, retryChange, rollbackChange } from '@/lib/ads/commands/engine'
import { engineResponse } from '@/lib/ads/commands/http'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const ActionSchema = z.object({
  action: z.enum(['approve', 'cancel', 'rollback', 'retry']),
  reason: z.string().max(500).optional(),
})

const IdSchema = z.string().uuid()

async function currentOrg(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_current_org_id')
  return (data as string | null) ?? null
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await dashboardActor()
  if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!IdSchema.safeParse(id).success) return Response.json({ error: 'Invalid id' }, { status: 400 })
  const orgId = await currentOrg()
  if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

  const result = await getChange(orgId, id)
  if (!result) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(result)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await dashboardActor()
  if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!actor.canManage) return Response.json({ error: 'You do not have permission to manage ads.' }, { status: 403 })
  const { id } = await params
  if (!IdSchema.safeParse(id).success) return Response.json({ error: 'Invalid id' }, { status: 400 })
  const orgId = await currentOrg()
  if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

  let raw: unknown
  try { raw = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = ActionSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  const args = { orgId, changeId: id, actor }
  switch (parsed.data.action) {
    case 'approve':
      return engineResponse(await approveChange(args))
    case 'cancel':
      return engineResponse(await cancelChange({ ...args, reason: parsed.data.reason }))
    case 'rollback':
      return engineResponse(await rollbackChange({ ...args, rationale: parsed.data.reason }))
    case 'retry':
      return engineResponse(await retryChange(args))
  }
}

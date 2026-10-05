// Ads Control Plane — change requests.
//
//   GET  /api/ads/changes?status=&platform=&ad_account_id=&campaign_id=&batch_id=&limit=
//   POST /api/ads/changes { command, mode?: 'preview' | 'submit', idempotency_key? }
//   POST /api/ads/changes { commands: [...], mode? }   (batch, shared batch_id)
//
// 'preview' records the change as awaiting_approval and returns the diff.
// 'submit' is preview + the caller's own confirmation: it executes right away
// when the caller's permissions satisfy the account policy.

import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { dashboardActor } from '@/lib/ads/commands/actors'
import { listChanges, previewChange, submitChange } from '@/lib/ads/commands/engine'
import { engineResponse } from '@/lib/ads/commands/http'
import type { ChangeStatus } from '@/lib/ads/commands/types'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const BodySchema = z
  .object({
    command: z.unknown().optional(),
    commands: z.array(z.unknown()).min(1).max(50).optional(),
    mode: z.enum(['preview', 'submit']).default('preview'),
    idempotency_key: z.string().min(8).max(200).optional(),
  })
  .refine((b) => (b.command !== undefined) !== (b.commands !== undefined), {
    message: 'Send either command or commands',
  })

const STATUSES: ChangeStatus[] = [
  'draft', 'validating', 'awaiting_approval', 'queued', 'executing', 'verifying',
  'succeeded', 'failed', 'drifted', 'cancelled', 'expired',
]

async function currentOrg(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_current_org_id')
  return (data as string | null) ?? null
}

export async function GET(request: NextRequest): Promise<Response> {
  const actor = await dashboardActor()
  if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = await currentOrg()
  if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

  const q = request.nextUrl.searchParams
  const status = (q.get('status') ?? '')
    .split(',')
    .filter((s): s is ChangeStatus => STATUSES.includes(s as ChangeStatus))
  const platform = q.get('platform')
  const changes = await listChanges(orgId, {
    status: status.length ? status : undefined,
    platform: platform === 'meta' || platform === 'google' || platform === 'google_business' ? platform : undefined,
    adAccountId: q.get('ad_account_id') ?? undefined,
    campaignId: q.get('campaign_id') ?? undefined,
    batchId: q.get('batch_id') ?? undefined,
    limit: Number(q.get('limit')) || 50,
  })
  return Response.json({ changes })
}

export async function POST(request: NextRequest): Promise<Response> {
  const actor = await dashboardActor()
  if (!actor) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!actor.canManage) return Response.json({ error: 'You do not have permission to manage ads.' }, { status: 403 })
  const orgId = await currentOrg()
  if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

  let raw: unknown
  try { raw = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const body = parsed.data
  const run = body.mode === 'submit' ? submitChange : previewChange

  if (!body.commands) {
    return engineResponse(await run({ orgId, actor, command: body.command, idempotencyKey: body.idempotency_key }))
  }

  // Batch: each command is its own ledger row (so one bad item never blocks
  // the rest), tied together by batch_id for review and approval.
  const batchId = randomUUID()
  const results = []
  for (const command of body.commands) {
    const result = await run({ orgId, actor, command, batchId, batchSize: body.commands.length })
    results.push(
      result.ok
        ? { ok: true, change: result.change }
        : { ok: false, code: result.code, error: result.message, violations: result.violations },
    )
  }
  const okCount = results.filter((r) => r.ok).length
  return Response.json(
    { batch_id: batchId, total: results.length, ok: okCount, failed: results.length - okCount, results },
    { status: okCount === 0 ? 422 : okCount < results.length ? 207 : 200 },
  )
}

import { NextRequest } from 'next/server'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import { ADS_MEMORY_COLUMNS, createMemory, updateMemory } from '@/lib/ads/journey-db'
import type { AdsMemoryType, AdsMemorySource } from '@/lib/ads/journey-db'
import { KnowledgeRefsInputSchema } from '@/lib/knowledge/refs'

export const runtime = 'nodejs'

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

// GET /api/ads/memories?status=active&platform=meta&limit=20
export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? 'active'
  const platform = url.searchParams.get('platform')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  // Explicit columns: '*' would ship each row's 1536-float embedding.
  let q = supabase
    .from('ads_memories')
    .select(ADS_MEMORY_COLUMNS)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (platform) q = q.or(`platform.eq.${platform},platform.is.null`)

  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ memories: data ?? [] })
}

const CreateMemorySchema = z.object({
  type: z.enum(['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal']),
  source: z.enum(['chat', 'mcp', 'manual', 'audit']).default('manual'),
  platform: z.enum(['meta', 'google']).optional(),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  campaign_id: z.string().optional(),
  campaign_name: z.string().optional(),
  confidence: z.number().int().min(1).max(5).default(3),
  proposed: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
  knowledge_refs: KnowledgeRefsInputSchema.optional(),
  change_request_id: z.string().uuid().optional(),
})

// POST /api/ads/memories
export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

  const parsed = CreateMemorySchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const id = await createMemory({
    orgId: orgId as string,
    type: parsed.data.type as AdsMemoryType,
    source: parsed.data.source as AdsMemorySource,
    platform: parsed.data.platform,
    title: parsed.data.title,
    content: parsed.data.content,
    campaignId: parsed.data.campaign_id,
    campaignName: parsed.data.campaign_name,
    confidence: parsed.data.confidence,
    proposed: parsed.data.proposed,
    metadata: parsed.data.metadata,
    knowledgeRefs: parsed.data.knowledge_refs,
    changeRequestId: parsed.data.change_request_id,
  })

  if (!id) return err('Failed to create memory', 500)
  return Response.json({ id }, { status: 201 })
}

// PATCH /api/ads/memories
//   { ids, status }                       — bulk status update
//   { id, status?, title?, content?, confidence?, superseded_by?, knowledge_refs? }
//                                         — curate one memory (edit / approve /
//                                           supersede); goes through updateMemory
//                                           so edited text is re-embedded.
const StatusSchema = z.enum(['active', 'archived', 'superseded', 'needs_review'])

const BulkPatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  status: StatusSchema,
}).strict()

const SinglePatchSchema = z.object({
  id: z.string().uuid(),
  status: StatusSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(2000).optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  superseded_by: z.string().uuid().optional(),
  knowledge_refs: KnowledgeRefsInputSchema.optional(),
}).strict()

const PatchSchema = z.union([BulkPatchSchema, SinglePatchSchema])

const UPDATE_ERROR_STATUS: Record<string, number> = {
  invalid_input: 400,
  invalid_superseded_by: 422,
  no_changes: 400,
  not_found: 404,
  update_failed: 500,
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  if ('id' in parsed.data) {
    const input = parsed.data
    const result = await updateMemory({
      orgId: orgId as string,
      memoryId: input.id,
      status: input.status,
      title: input.title,
      content: input.content,
      confidence: input.confidence,
      supersededBy: input.superseded_by,
      knowledgeRefs: input.knowledge_refs,
    })
    if (!result.ok) {
      return Response.json(
        { error: result.error, detail: result.detail },
        { status: UPDATE_ERROR_STATUS[result.error] ?? 400 },
      )
    }
    return Response.json({ ok: true, memory: result.memory })
  }

  // Status-only bulk change: no text changes, so no re-embedding. Approving
  // (→ active) also clears `proposed`, matching updateMemory.
  const update: { status: string; proposed?: boolean } = { status: parsed.data.status }
  if (parsed.data.status === 'active') update.proposed = false

  // RLS ensures we only update our own org's memories
  const { error } = await supabase
    .from('ads_memories')
    .update(update)
    .in('id', parsed.data.ids)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

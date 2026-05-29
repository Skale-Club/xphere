import { NextRequest } from 'next/server'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import { createMemory, getOrCreateJourney } from '@/lib/ads/journey-db'
import type { AdsMemoryType, AdsMemorySource } from '@/lib/ads/journey-db'

export const runtime = 'nodejs'

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

// GET /api/ads/memories?status=active&platform=meta&limit=20
export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return err('Forbidden', 403)

  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? 'active'
  const platform = url.searchParams.get('platform')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  let q = supabase
    .from('ads_memories')
    .select('*')
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
})

// POST /api/ads/memories
export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return err('Forbidden', 403)

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
  })

  if (!id) return err('Failed to create memory', 500)
  return Response.json({ id }, { status: 201 })
}

// PATCH /api/ads/memories — bulk status update
const PatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  status: z.enum(['active', 'archived', 'superseded', 'needs_review']),
})

export async function PATCH(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return err('Forbidden', 403)

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  // RLS ensures we only update our own org's memories
  const { error } = await supabase
    .from('ads_memories')
    .update({ status: parsed.data.status })
    .in('id', parsed.data.ids)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

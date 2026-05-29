import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

export type AdsMemoryType = 'insight' | 'decision' | 'plan' | 'risk' | 'observation' | 'result' | 'goal'
export type AdsMemoryStatus = 'active' | 'archived' | 'superseded' | 'needs_review'
export type AdsMemorySource = 'chat' | 'mcp' | 'manual' | 'audit'

export type AdsMemory = {
  id: string
  org_id: string
  journey_id: string
  type: AdsMemoryType
  status: AdsMemoryStatus
  source: AdsMemorySource
  platform: 'meta' | 'google' | null
  title: string
  content: string
  campaign_id: string | null
  campaign_name: string | null
  confidence: number
  proposed: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function db() { return createServiceRoleClient() }

export async function getOrCreateJourney(orgId: string): Promise<{ id: string }> {
  const { data: existing } = await db()
    .from('ads_journey')
    .select('id')
    .eq('org_id', orgId)
    .maybeSingle()

  if (existing) return existing as { id: string }

  const { data: created } = await db()
    .from('ads_journey')
    .insert({ org_id: orgId, title: 'Ads Journey' })
    .select('id')
    .single()

  if (!created) throw new Error('Failed to create journey')
  return created as { id: string }
}

export async function fetchRecentMemories(
  orgId: string,
  platform?: 'meta' | 'google',
  limit = 10,
): Promise<AdsMemory[]> {
  let q = db()
    .from('ads_memories')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (platform) q = q.or(`platform.eq.${platform},platform.is.null`)

  const { data } = await q
  return (data ?? []) as AdsMemory[]
}

export async function createMemory(params: {
  orgId: string
  type: AdsMemoryType
  source: AdsMemorySource
  platform?: 'meta' | 'google'
  title: string
  content: string
  campaignId?: string
  campaignName?: string
  confidence?: number
  proposed?: boolean
  status?: AdsMemoryStatus
  metadata?: Record<string, unknown>
}): Promise<string | null> {
  try {
    const journey = await getOrCreateJourney(params.orgId)
    const { data } = await db()
      .from('ads_memories')
      .insert({
        org_id: params.orgId,
        journey_id: journey.id,
        type: params.type,
        status: params.status ?? (params.proposed ? 'needs_review' : 'active'),
        source: params.source,
        platform: params.platform ?? null,
        title: params.title,
        content: params.content,
        campaign_id: params.campaignId ?? null,
        campaign_name: params.campaignName ?? null,
        confidence: params.confidence ?? 3,
        proposed: params.proposed ?? false,
        metadata: (params.metadata ?? {}) as Json,
      })
      .select('id')
      .single()
    return data?.id ?? null
  } catch {
    return null
  }
}

export async function recordMutationExecution(params: {
  toolName: string
  input: Record<string, unknown>
  orgId: string
  platform: 'meta' | 'google'
}): Promise<void> {
  try {
    const journey = await getOrCreateJourney(params.orgId)

    let type: string
    let title: string
    let afterValue: string | undefined
    const campaignId = params.input.campaign_id as string | undefined
    const campaignName = params.input.campaign_name as string | undefined

    switch (params.toolName) {
      case 'pause_campaign':
        type = 'campaign_pause'
        title = campaignName ? `Campaign paused: ${campaignName}` : 'Campaign paused'
        break
      case 'enable_campaign':
        type = 'campaign_enable'
        title = campaignName ? `Campaign enabled: ${campaignName}` : 'Campaign enabled'
        break
      case 'set_daily_budget': {
        const budget = params.input.daily_budget_usd as number | undefined
        type = 'budget_increase'
        title = campaignName
          ? `Budget updated: ${campaignName} → $${budget ?? '?'}/day`
          : `Budget updated → $${budget ?? '?'}/day`
        afterValue = budget != null ? `$${budget}/day` : undefined
        break
      }
      default:
        type = 'manual'
        title = `Action executed: ${params.toolName}`
    }

    await db().from('ads_executions').insert({
      org_id: params.orgId,
      journey_id: journey.id,
      type,
      platform: params.platform,
      title,
      campaign_id: campaignId ?? null,
      campaign_name: campaignName ?? null,
      after_value: afterValue ?? null,
      executed_by_ai: true,
    })
  } catch {
    // non-blocking — never throw
  }
}

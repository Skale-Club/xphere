import { NextRequest } from 'next/server'
import { z } from 'zod'

import { decrypt } from '@/lib/crypto'
import { updateCampaignStatus, updateCampaignDailyBudget, MetaAdsError } from '@/lib/ads/meta-api'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MutateSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    campaign_id: z.string().min(1),
    ad_account_id: z.string().min(1),
    status: z.enum(['ACTIVE', 'PAUSED']),
  }),
  z.object({
    action: z.literal('set_daily_budget'),
    campaign_id: z.string().min(1),
    ad_account_id: z.string().min(1),
    daily_budget_cents: z.number().int().positive(),
  }),
])

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON')
  }

  const parsed = MutateSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const data = parsed.data
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const { data: conn } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token')
    .eq('org_id', orgId as string)
    .eq('ad_account_id', data.ad_account_id)
    .eq('platform', 'meta')
    .eq('status', 'active')
    .maybeSingle()

  if (!conn) return err('No active Meta Ads connection', 404)

  const accessToken = await decrypt(conn.encrypted_access_token)

  try {
    if (data.action === 'set_status') {
      const result = await updateCampaignStatus(data.campaign_id, data.status, accessToken)
      return Response.json(result)
    }

    if (data.action === 'set_daily_budget') {
      const result = await updateCampaignDailyBudget(data.campaign_id, data.daily_budget_cents, accessToken)
      return Response.json(result)
    }

    return err('Unknown action')
  } catch (e) {
    if (e instanceof MetaAdsError) {
      return Response.json({ error: e.message, code: e.code }, { status: 502 })
    }
    return Response.json({ error: 'Meta API error' }, { status: 502 })
  }
}

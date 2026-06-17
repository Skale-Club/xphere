import { NextRequest } from 'next/server'
import { z } from 'zod'

import { decrypt } from '@/lib/crypto'
import { parseTokens, updateCampaignStatus, updateCampaignBudget, GoogleAdsError } from '@/lib/ads/google-api'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MutateSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    customer_id: z.string().min(1),
    campaign_id: z.string().min(1),
    status: z.enum(['ENABLED', 'PAUSED']),
  }),
  z.object({
    action: z.literal('set_budget'),
    customer_id: z.string().min(1),
    budget_id: z.string().min(1),
    daily_budget_usd: z.number().positive(),
    currency_micros_per_unit: z.number().default(1_000_000),
  }),
])

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

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
    .eq('ad_account_id', data.customer_id)
    .eq('platform', 'google')
    .eq('status', 'active')
    .maybeSingle()

  if (!conn) return err('No active Google Ads connection', 404)

  const tokens = parseTokens(await decrypt(conn.encrypted_access_token))

  try {
    if (data.action === 'set_status') {
      await updateCampaignStatus(data.customer_id, data.campaign_id, data.status, tokens.refresh_token)
      return Response.json({ ok: true })
    }

    if (data.action === 'set_budget') {
      const amountMicros = Math.round(data.daily_budget_usd * data.currency_micros_per_unit)
      await updateCampaignBudget(data.customer_id, data.budget_id, amountMicros, tokens.refresh_token)
      return Response.json({ ok: true })
    }

    return err('Unknown action')
  } catch (e) {
    if (e instanceof GoogleAdsError) return Response.json({ error: e.message, code: e.code }, { status: 502 })
    return Response.json({ error: 'Google Ads API error' }, { status: 502 })
  }
}

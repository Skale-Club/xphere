import { NextRequest } from 'next/server'

import { decrypt } from '@/lib/crypto'
import { getInsights, listCampaigns, listAdSets, getAdAccountInfo, type DatePreset } from '@/lib/ads/meta-api'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

async function getAccessToken(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, adAccountId: string): Promise<string | null> {
  const { data } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token')
    .eq('org_id', orgId)
    .eq('ad_account_id', adAccountId)
    .eq('platform', 'meta')
    .eq('status', 'active')
    .maybeSingle()

  if (!data) return null
  return decrypt(data.encrypted_access_token)
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return err('Forbidden', 403)

  const url = new URL(request.url)
  const report = url.searchParams.get('report') // overview|campaigns|adsets|insights
  const adAccountId = url.searchParams.get('ad_account_id')
  const datePreset = (url.searchParams.get('date_preset') ?? 'last_30d') as DatePreset
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  // Either an explicit custom range (since/until) or a named preset.
  const dateOpts = since && until ? { timeRange: { since, until } } : { datePreset }
  const campaignId = url.searchParams.get('campaign_id') ?? undefined
  const level = (url.searchParams.get('level') ?? 'campaign') as 'account' | 'campaign' | 'adset' | 'ad'

  if (!adAccountId) return err('ad_account_id required')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org', 400)

  const accessToken = await getAccessToken(supabase, orgId as string, adAccountId)
  if (!accessToken) return err('No active Meta Ads connection for this account', 404)

  try {
    switch (report) {
      case 'overview': {
        const [accountInfo, insights] = await Promise.all([
          getAdAccountInfo(adAccountId, accessToken),
          getInsights(adAccountId, accessToken, { level: 'account', ...dateOpts }),
        ])
        return Response.json({ account: accountInfo, insights: insights.data[0] ?? null })
      }

      case 'campaigns': {
        const [campaigns, insights] = await Promise.all([
          listCampaigns(adAccountId, accessToken),
          getInsights(adAccountId, accessToken, { level: 'campaign', ...dateOpts }),
        ])
        const insightMap = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).campaign_id, i]))
        const enriched = campaigns.map((c) => ({ ...c, insights: insightMap.get(c.id) ?? null }))
        return Response.json({ data: enriched })
      }

      case 'adsets': {
        const [adsets, insights] = await Promise.all([
          listAdSets(adAccountId, accessToken, campaignId),
          getInsights(adAccountId, accessToken, { level: 'adset', ...dateOpts }),
        ])
        const insightMap = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).adset_id, i]))
        const enriched = adsets.map((s) => ({ ...s, insights: insightMap.get(s.id) ?? null }))
        return Response.json({ data: enriched })
      }

      case 'insights': {
        const data = await getInsights(adAccountId, accessToken, {
          level: level as 'account' | 'campaign' | 'adset' | 'ad',
          ...dateOpts,
        })
        return Response.json(data)
      }

      default:
        return err('Unknown report type')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Meta API error'
    return Response.json({ error: msg }, { status: 502 })
  }
}

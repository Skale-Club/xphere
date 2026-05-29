import { NextRequest } from 'next/server'

import { decrypt } from '@/lib/crypto'
import {
  parseTokens,
  getAccountOverview,
  listCampaigns,
  listAdGroups,
  toGaqlDuration,
} from '@/lib/ads/google-api'
import { getCustomerInfo } from '@/lib/ads/google-oauth'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return err('Forbidden', 403)

  const url = new URL(request.url)
  const report = url.searchParams.get('report') ?? 'overview'
  const customerId = url.searchParams.get('customer_id')
  const datePreset = url.searchParams.get('date_preset') ?? 'last_30d'
  const campaignId = url.searchParams.get('campaign_id') ?? undefined

  if (!customerId) return err('customer_id required')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const { data: conn } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token, ad_account_name')
    .eq('org_id', orgId as string)
    .eq('ad_account_id', customerId)
    .eq('platform', 'google')
    .eq('status', 'active')
    .maybeSingle()

  if (!conn) return err('No active Google Ads connection for this customer', 404)

  const decrypted = await decrypt(conn.encrypted_access_token)
  const tokens = parseTokens(decrypted)
  const duration = toGaqlDuration(datePreset)

  try {
    switch (report) {
      case 'overview': {
        const [info, overview] = await Promise.all([
          getCustomerInfo(customerId, tokens.access_token).catch(() => ({
            id: customerId,
            name: conn.ad_account_name ?? customerId,
            currency_code: 'USD',
            manager: false,
            test_account: false,
          })),
          getAccountOverview(customerId, tokens.refresh_token, duration),
        ])
        return Response.json({ customer: info, metrics: overview })
      }

      case 'campaigns': {
        const campaigns = await listCampaigns(customerId, tokens.refresh_token, duration)
        return Response.json({ data: campaigns })
      }

      case 'adgroups': {
        const adgroups = await listAdGroups(customerId, tokens.refresh_token, duration, campaignId)
        return Response.json({ data: adgroups })
      }

      default:
        return err('Unknown report type')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Google Ads API error'
    return Response.json({ error: msg }, { status: 502 })
  }
}

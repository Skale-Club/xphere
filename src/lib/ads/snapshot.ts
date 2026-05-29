import { listCampaigns as metaListCampaigns, getInsights, getAdAccountInfo } from './meta-api'
import { listCampaigns as googleListCampaigns, getAccountOverview, toGaqlDuration } from './google-api'
import { getCustomerInfo, refreshAccessToken } from './google-oauth'

// Builds a compact text snapshot of an ad account for injection into the AI
// system prompt. Keeps it tight (< 1500 chars) so it doesn't waste tokens.
// Always resolves — returns '' on any error so the chat still works.

function usd(micros: string | number): string {
  return `$${(Number(micros) / 1_000_000).toFixed(2)}`
}

function fmt(n: string | number, decimals = 0): string {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: decimals })
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export async function buildMetaSnapshot(adAccountId: string, accessToken: string): Promise<string> {
  try {
    const [account, campaigns, insights] = await Promise.all([
      getAdAccountInfo(adAccountId, accessToken),
      metaListCampaigns(adAccountId, accessToken),
      getInsights(adAccountId, accessToken, { level: 'campaign', datePreset: 'last_30d' }),
    ])

    // campaign_id is returned alongside the insight row at campaign level
    const insightMap = new Map(
      insights.data.map((i) => {
        const row = i as typeof i & { campaign_id?: string }
        return [row.campaign_id ?? '', i]
      }),
    )

    const active = campaigns.filter((c) => c.effective_status === 'ACTIVE' || c.status === 'ACTIVE')

    let totalSpend = 0
    let totalImpressions = 0
    let totalClicks = 0
    let totalLeads = 0

    const rows = active.map((c) => {
      const ins = insightMap.get(c.id)
      const spend = parseFloat(ins?.spend ?? '0')
      const impressions = parseInt(ins?.impressions ?? '0', 10)
      const clicks = parseInt(ins?.clicks ?? '0', 10)
      const leads = parseInt(
        ins?.actions?.find((a) => a.action_type === 'lead')?.value ?? '0',
        10,
      )
      totalSpend += spend
      totalImpressions += impressions
      totalClicks += clicks
      totalLeads += leads

      const budget = c.daily_budget
        ? `$${(parseInt(c.daily_budget, 10) / 100).toFixed(0)}/day`
        : c.lifetime_budget
          ? `$${(parseInt(c.lifetime_budget, 10) / 100).toFixed(0)} lifetime`
          : '—'
      const cpl = leads > 0 ? `$${(spend / leads).toFixed(2)}` : '—'
      const ctr = impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}%` : '—'

      return `  ${c.name.slice(0, 30).padEnd(30)} ${budget.padEnd(14)} $${spend.toFixed(0).padEnd(8)} ${fmt(impressions).padEnd(10)} ${fmt(clicks).padEnd(8)} ${ctr.padEnd(8)} ${leads > 0 ? `${leads} leads / CPL ${cpl}` : ''}`
    })

    const avgCpl = totalLeads > 0 ? ` | Avg CPL: $${(totalSpend / totalLeads).toFixed(2)}` : ''
    const ctr = totalImpressions > 0 ? ` | CTR: ${((totalClicks / totalImpressions) * 100).toFixed(2)}%` : ''

    const lines = [
      `## Meta Ads — ${account.name} (${account.currency}) · Last 30 days`,
      `Spend: $${totalSpend.toFixed(0)} | Impressions: ${fmt(totalImpressions)} | Clicks: ${fmt(totalClicks)}${ctr}${avgCpl}`,
      `Active campaigns: ${active.length} of ${campaigns.length} total`,
      '',
      `  ${'Campaign'.padEnd(30)} ${'Budget'.padEnd(14)} ${'Spend'.padEnd(9)} ${'Impressions'.padEnd(10)} ${'Clicks'.padEnd(8)} ${'CTR'.padEnd(8)} Leads`,
      `  ${'─'.repeat(90)}`,
      ...rows,
    ]

    return lines.join('\n')
  } catch {
    return ''
  }
}

// ─── Google ───────────────────────────────────────────────────────────────────

export async function buildGoogleSnapshot(customerId: string, refreshToken: string): Promise<string> {
  try {
    const accessToken = await refreshAccessToken(refreshToken)
    const duration = toGaqlDuration('last_30d')

    const [account, overview, campaigns] = await Promise.all([
      getCustomerInfo(customerId, accessToken).catch(() => ({
        id: customerId,
        name: customerId,
        currency_code: 'USD',
        manager: false,
        test_account: false,
      })),
      getAccountOverview(customerId, refreshToken, duration),
      googleListCampaigns(customerId, refreshToken, duration),
    ])

    const active = campaigns.filter((c) => c.status === 'ENABLED')
    const totalCost = Number(overview.costMicros)
    const totalConversions = parseFloat(overview.conversions)
    const costPerConv = totalConversions > 0 ? totalCost / totalConversions / 1_000_000 : null

    const rows = active.map((c) => {
      const cost = Number(c.costMicros)
      const conv = parseFloat(c.conversions)
      const budget = `$${(Number(c.budgetAmountMicros) / 1_000_000).toFixed(0)}/day`
      const cpa = conv > 0 ? `$${(cost / conv / 1_000_000).toFixed(2)}` : '—'
      return `  ${c.name.slice(0, 30).padEnd(30)} ${budget.padEnd(12)} ${usd(cost).padEnd(10)} ${fmt(c.impressions).padEnd(12)} ${fmt(c.clicks).padEnd(8)} ${conv > 0 ? `${fmt(conv, 1)} conv / CPA ${cpa}` : '—'}`
    })

    const cpaLine = costPerConv ? ` | Avg CPA: $${costPerConv.toFixed(2)}` : ''

    const lines = [
      `## Google Ads — ${account.name} (${account.currency_code}) · Last 30 days`,
      `Spend: ${usd(overview.costMicros)} | Impressions: ${fmt(overview.impressions)} | Clicks: ${fmt(overview.clicks)} | Conversions: ${fmt(overview.conversions, 1)}${cpaLine}`,
      `Active campaigns: ${active.length} of ${campaigns.length} total`,
      '',
      `  ${'Campaign'.padEnd(30)} ${'Budget'.padEnd(12)} ${'Spend'.padEnd(10)} ${'Impressions'.padEnd(12)} ${'Clicks'.padEnd(8)} Performance`,
      `  ${'─'.repeat(90)}`,
      ...rows,
    ]

    return lines.join('\n')
  } catch {
    return ''
  }
}

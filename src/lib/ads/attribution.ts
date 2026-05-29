import { createClient } from '@/lib/supabase/server'

export type AttributionRow = {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  sessions: number
  identified_contacts: number
  opportunities: number
  revenue: number
}

export type AttributionSummary = {
  rows: AttributionRow[]
  totals: {
    sessions: number
    identified_contacts: number
    opportunities: number
    revenue: number
  }
}

/**
 * Returns UTM-level attribution data joining traffic_sessions → traffic_visitors →
 * contacts → opportunities. Uses TWO signals:
 *   1. traffic_visitors.contact_id (visitor identified at any point in the session)
 *   2. traffic_events.contact_id (contact_created / opportunity_created events)
 * Both paths are UNION-ed so we get maximum coverage.
 *
 * platformFilter: 'meta' | 'google' | null (null = all sources)
 */
export async function getAdsAttribution(opts: {
  from: string
  to: string
  platformFilter: 'meta' | 'google' | null
}): Promise<AttributionSummary> {
  const supabase = await createClient()

  // Build source filter clause per platform
  // Meta campaigns typically use utm_source='meta'|'facebook'|'instagram', medium='cpc'|'paid_social'
  // Google Ads typically uses utm_source='google', medium='cpc'|'ppc'|'paidsearch'
  const { from, to, platformFilter } = opts

  // We run this as a raw SQL query via rpc for efficiency
  // Falls back to individual queries if rpc not available
  const { data, error } = await supabase.rpc('get_ads_attribution', {
    p_from: from,
    p_to: to,
    p_platform: platformFilter ?? undefined,
  })

  if (error) {
    // Fallback: run via JS-level queries (slower but no migration needed)
    return getAdsAttributionFallback(opts)
  }

  const rows = (data ?? []) as AttributionRow[]
  const totals = rows.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      identified_contacts: acc.identified_contacts + r.identified_contacts,
      opportunities: acc.opportunities + r.opportunities,
      revenue: acc.revenue + r.revenue,
    }),
    { sessions: 0, identified_contacts: 0, opportunities: 0, revenue: 0 },
  )

  return { rows, totals }
}

/**
 * Fallback implementation using Supabase JS client.
 * Less efficient but works without a DB migration.
 */
async function getAdsAttributionFallback(opts: {
  from: string
  to: string
  platformFilter: 'meta' | 'google' | null
}): Promise<AttributionSummary> {
  const supabase = await createClient()
  const { from, to, platformFilter } = opts

  let query = supabase
    .from('traffic_sessions')
    .select(`
      id,
      utm_source,
      utm_medium,
      utm_campaign,
      traffic_visitors!inner (
        contact_id,
        contacts:contact_id (
          id,
          opportunities (
            id,
            value,
            status
          )
        )
      )
    `)
    .gte('started_at', from)
    .lte('started_at', to)
    .not('utm_campaign', 'is', null)

  if (platformFilter === 'meta') {
    query = query.in('utm_source', ['meta', 'facebook', 'instagram', 'fb'])
  } else if (platformFilter === 'google') {
    query = query.in('utm_source', ['google', 'adwords', 'google-ads'])
  }

  const { data: sessions } = await query.limit(2000)
  if (!sessions?.length) return { rows: [], totals: { sessions: 0, identified_contacts: 0, opportunities: 0, revenue: 0 } }

  // Aggregate in-memory
  const map = new Map<string, AttributionRow>()

  for (const session of sessions) {
    const key = `${session.utm_source ?? ''}|${session.utm_medium ?? ''}|${session.utm_campaign ?? ''}`
    if (!map.has(key)) {
      map.set(key, {
        utm_source: session.utm_source,
        utm_medium: session.utm_medium,
        utm_campaign: session.utm_campaign,
        sessions: 0,
        identified_contacts: 0,
        opportunities: 0,
        revenue: 0,
      })
    }
    const row = map.get(key)!
    row.sessions++

    const visitor = (session as unknown as { traffic_visitors?: { contact_id?: string; contacts?: { id: string; opportunities?: Array<{ id: string; value?: number; status?: string }> } | null } }).traffic_visitors
    if (visitor?.contact_id) {
      row.identified_contacts++
      const opps = visitor.contacts?.opportunities ?? []
      for (const opp of opps) {
        row.opportunities++
        row.revenue += opp.value ?? 0
      }
    }
  }

  const rows = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions)
  const totals = rows.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      identified_contacts: acc.identified_contacts + r.identified_contacts,
      opportunities: acc.opportunities + r.opportunities,
      revenue: acc.revenue + r.revenue,
    }),
    { sessions: 0, identified_contacts: 0, opportunities: 0, revenue: 0 },
  )

  return { rows, totals }
}

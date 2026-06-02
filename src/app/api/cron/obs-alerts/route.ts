// O3: observability alerting cron.
// Invoked by .github/workflows/obs-alerts.yml (hourly). Checks existing signals
// cross-org and posts deduped Slack alerts:
//   1. Agent cost near the daily cap (>= 80%)
//   2. Google Reviews scrape failures (error / quota_exceeded)
//   3. High agent error rate in the last hour
//
// Caller sends CRON_SECRET as `Authorization: Bearer`. No-ops cleanly when
// SLACK_ALERTS_WEBHOOK_URL is unset, so it is safe to schedule before the
// webhook secret is configured.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createLogger } from '@/lib/obs/logger'
import {
  type Alert,
  alreadyAlerted,
  costBreached,
  costSeverity,
  errorRateBreached,
  recordAlert,
  sendSlackAlert,
  slackConfigured,
} from '@/lib/obs/alerts'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET
const DEFAULT_DAILY_CAP_USD = parseFloat(process.env.AGENT_DAILY_COST_CAP_USD ?? '50')

export async function GET(request: Request): Promise<Response> {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  const log = createLogger({ route: 'api/cron/obs-alerts' })
  if (!slackConfigured()) {
    return Response.json({ ok: true, skipped: 'SLACK_ALERTS_WEBHOOK_URL not set' })
  }

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const dedupe = supabase as unknown as SupabaseClient
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const hourBucket = new Date(now).toISOString().slice(0, 13)
  const candidates: Alert[] = []

  // 1. Cost near daily cap (24h, per org) ────────────────────────────────────
  const since24h = new Date(now - 24 * 3_600_000).toISOString()
  const { data: costRows } = await supabase
    .from('agent_invocations')
    .select('organization_id, cost_usd')
    .gte('created_at', since24h)
    .not('cost_usd', 'is', null)

  const costByOrg = new Map<string, number>()
  for (const r of costRows ?? []) {
    costByOrg.set(r.organization_id, (costByOrg.get(r.organization_id) ?? 0) + Number(r.cost_usd ?? 0))
  }

  if (costByOrg.size > 0) {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name, daily_cost_cap_usd_override')
      .in('id', [...costByOrg.keys()])
    const orgMeta = new Map((orgs ?? []).map((o) => [o.id, o]))

    for (const [orgId, cost] of costByOrg) {
      const meta = orgMeta.get(orgId)
      const cap = meta?.daily_cost_cap_usd_override != null
        ? Number(meta.daily_cost_cap_usd_override)
        : DEFAULT_DAILY_CAP_USD
      if (!costBreached(cost, cap)) continue
      const pct = Math.round((cost / cap) * 100)
      candidates.push({
        key: `cost:${orgId}:${today}`,
        title: 'Agent cost near daily cap',
        severity: costSeverity(pct),
        fields: {
          org: meta?.name ?? orgId,
          spent: `$${cost.toFixed(2)}`,
          cap: `$${cap.toFixed(2)}`,
          used: `${pct}%`,
        },
      })
    }
  }

  // 2. Google Reviews scrape failures (last 25h) ─────────────────────────────
  const since25h = new Date(now - 25 * 3_600_000).toISOString()
  const { data: scrapeFails } = await supabase
    .from('google_business_profiles')
    .select('id, business_name, last_scrape_status, last_scrape_error, last_scraped_at')
    .in('last_scrape_status', ['error', 'quota_exceeded'])
    .gte('last_scraped_at', since25h)

  for (const p of scrapeFails ?? []) {
    candidates.push({
      key: `scrape:${p.id}:${p.last_scraped_at}`,
      title: 'Google Reviews scrape failed',
      severity: p.last_scrape_status === 'quota_exceeded' ? 'warning' : 'critical',
      fields: {
        business: p.business_name ?? p.id,
        status: p.last_scrape_status ?? 'unknown',
        error: (p.last_scrape_error ?? '').slice(0, 140) || '-',
      },
    })
  }

  // 3. Agent error rate (last hour) ──────────────────────────────────────────
  const since1h = new Date(now - 3_600_000).toISOString()
  const { data: invs } = await supabase
    .from('agent_invocations')
    .select('status')
    .gte('created_at', since1h)
    .neq('status', 'running')

  const total = invs?.length ?? 0
  const errors = (invs ?? []).filter((i) => i.status === 'error' || i.status === 'aborted').length
  if (errorRateBreached(total, errors)) {
    candidates.push({
      key: `errorrate:${hourBucket}`,
      title: 'High agent error rate (last hour)',
      severity: 'critical',
      fields: { errors, total, rate: `${Math.round((errors / total) * 100)}%` },
    })
  }

  // Dedupe + deliver ─────────────────────────────────────────────────────────
  // Window: cost re-alerts at most every 6h; scrape per failure once/24h;
  // error rate once per hour bucket.
  let sent = 0
  for (const alert of candidates) {
    const windowMinutes = alert.key.startsWith('cost:') ? 360 : alert.key.startsWith('scrape:') ? 1440 : 60
    if (await alreadyAlerted(dedupe, alert.key, windowMinutes)) continue
    if (await sendSlackAlert(alert)) {
      await recordAlert(dedupe, alert.key)
      sent++
    }
  }

  log.info('obs_alerts_run', { candidates: candidates.length, sent })
  return Response.json({ ok: true, candidates: candidates.length, sent })
}

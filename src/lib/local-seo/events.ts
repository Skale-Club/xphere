import 'server-only'

// What happens after a scan closes:
//
//   1. workflow event local_seo.scan_completed (always)
//   2. compare with the previous comparable scan; when any metric moved,
//      workflow event local_seo.rank_changed with the deltas
//   3. alert rules: each matching rule records a local_seo_alerts row and an
//      in-app notification (+ push). Email/Telegram/Slack are left to
//      workflows listening on local_seo.rank_changed, so each org routes
//      alerts its own way instead of a hardcoded channel list.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { insertNotification } from '@/lib/notifications/insert'

import { dispatchLocalSeoWorkflowEvent } from './workflow-events'

type Admin = SupabaseClient<Database>
type ScanRow = Database['public']['Tables']['local_seo_scans']['Row']
type RuleRow = Database['public']['Tables']['local_seo_alert_rules']['Row']

export type MetricKey = 'solv' | 'arp' | 'atrp' | 'found_pct'
export const METRIC_LABEL: Record<MetricKey, string> = {
  solv: 'SoLV',
  arp: 'Average rank',
  atrp: 'ATRP',
  found_pct: 'Found %',
}
/** Rank metrics improve downwards; share metrics improve upwards. */
const LOWER_IS_BETTER: Record<MetricKey, boolean> = { solv: false, arp: true, atrp: true, found_pct: false }

export type MetricChange = { metric: MetricKey; previous: number | null; current: number | null; delta: number | null; worse: boolean | null }

export function diffMetrics(current: Pick<ScanRow, MetricKey>, previous: Pick<ScanRow, MetricKey>): MetricChange[] {
  return (Object.keys(LOWER_IS_BETTER) as MetricKey[]).map((metric) => {
    const cur = current[metric] === null ? null : Number(current[metric])
    const prev = previous[metric] === null ? null : Number(previous[metric])
    if (cur === null || prev === null) return { metric, previous: prev, current: cur, delta: null, worse: null }
    const delta = Math.round((cur - prev) * 100) / 100
    return { metric, previous: prev, current: cur, delta, worse: delta === 0 ? false : LOWER_IS_BETTER[metric] ? delta > 0 : delta < 0 }
  })
}

/** Does this change trip the rule? */
export function ruleMatches(rule: Pick<RuleRow, 'metric' | 'direction' | 'threshold'>, change: MetricChange): boolean {
  if (change.metric !== rule.metric || change.delta === null || change.delta === 0) return false
  if (Math.abs(change.delta) < Number(rule.threshold)) return false
  if (rule.direction === 'worse') return change.worse === true
  if (rule.direction === 'better') return change.worse === false
  return true
}

function scanPayload(scan: ScanRow) {
  return {
    id: scan.id,
    keyword: scan.keyword,
    status: scan.status,
    grid_size: scan.grid_size,
    spacing_m: scan.spacing_m,
    points_total: scan.points_total,
    points_done: scan.points_done,
    points_failed: scan.points_failed,
    arp: scan.arp,
    atrp: scan.atrp,
    solv: scan.solv,
    found_pct: scan.found_pct,
    triggered_by: scan.triggered_by,
    finished_at: scan.finished_at,
  }
}

export async function onScanFinalized(admin: Admin, scan: ScanRow): Promise<void> {
  const [{ data: location }, { data: previous }] = await Promise.all([
    admin
      .from('local_seo_locations')
      .select('id, name, business_name, address, place_id')
      .eq('id', scan.location_id)
      .maybeSingle(),
    admin
      .from('local_seo_scans')
      .select('*')
      .eq('location_id', scan.location_id)
      .eq('comparable_key', scan.comparable_key)
      .in('status', ['completed', 'partial'])
      .lt('created_at', scan.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (!location) return

  const base = {
    scan: scanPayload(scan),
    location: { id: location.id, name: location.name, business_name: location.business_name, address: location.address, place_id: location.place_id },
    url: `/local-seo/${location.id}?keyword=${scan.keyword_id ?? ''}&scan=${scan.id}`,
  }
  await dispatchLocalSeoWorkflowEvent(admin, scan.org_id, 'local_seo.scan_completed', scan.id, base)

  if (!previous || scan.status === 'failed') return
  const changes = diffMetrics(scan, previous)
  const moved = changes.filter((c) => c.delta !== null && c.delta !== 0)
  if (moved.length) {
    await dispatchLocalSeoWorkflowEvent(admin, scan.org_id, 'local_seo.rank_changed', scan.id, {
      ...base,
      previous: scanPayload(previous),
      change: Object.fromEntries(changes.map((c) => [c.metric, { from: c.previous, to: c.current, delta: c.delta, worse: c.worse }])),
    })
  }

  const { data: rules } = await admin
    .from('local_seo_alert_rules')
    .select('*')
    .eq('org_id', scan.org_id)
    .eq('is_active', true)
  for (const rule of rules ?? []) {
    if (rule.location_id && rule.location_id !== scan.location_id) continue
    const change = changes.find((c) => c.metric === rule.metric)
    if (!change || !ruleMatches(rule, change)) continue
    const { data: inserted } = await admin
      .from('local_seo_alerts')
      .upsert(
        {
          org_id: scan.org_id,
          location_id: scan.location_id,
          keyword_id: scan.keyword_id,
          keyword: scan.keyword,
          scan_id: scan.id,
          previous_scan_id: previous.id,
          rule_id: rule.id,
          metric: rule.metric,
          previous_value: change.previous,
          current_value: change.current,
          delta: change.delta!,
          is_worse: change.worse === true,
        },
        { onConflict: 'scan_id,rule_id', ignoreDuplicates: true },
      )
      .select('id')
    if (!inserted?.length) continue // already alerted for this scan
    if (rule.channels.includes('in_app')) {
      await insertNotification(scan.org_id, 'local_seo_alert', {
        alert_id: inserted[0].id,
        location_id: location.id,
        location_name: location.name,
        keyword: scan.keyword,
        keyword_id: scan.keyword_id,
        scan_id: scan.id,
        metric: rule.metric,
        metric_label: METRIC_LABEL[rule.metric],
        previous_value: change.previous,
        current_value: change.current,
        delta: change.delta,
        is_worse: change.worse === true,
      }, undefined, { waitForPush: true })
    }
  }
}

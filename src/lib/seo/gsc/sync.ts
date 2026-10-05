// Daily Search Console sync for SEO sites (runs inside /api/cron/seo-tick).
//
// Per site, at most once a day (claim_gsc_syncs leases via gsc_next_sync_at):
//   * daily clicks/impressions/CTR/position by device — 16 months on the
//     first sync (backfill), then the last few days again, because Search
//     Console keeps revising the most recent ~3 days;
//   * a weekly snapshot of the top 500 queries and pages over the trailing
//     28 days (seo_gsc_top, kept 26 weeks).
// Free-form drill-downs are not persisted (spec: volume on Supabase Free).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { querySearchAnalytics, GscApiError, type GscRow } from './client'
import { getGscAccessToken, GscNotConnectedError } from './tokens'
import { addDays, addMonths, daysBetween, isoDate } from './dates'

type Sb = SupabaseClient<Database>
type SiteRow = Database['public']['Tables']['seo_sites']['Row']
type DailyInsert = Database['public']['Tables']['seo_gsc_daily']['Insert']
type TopInsert = Database['public']['Tables']['seo_gsc_top']['Insert']

export const GSC_SITES_PER_TICK = 3
export const BACKFILL_MONTHS = 16
/** Days re-fetched on every incremental sync (GSC revises recent data). */
export const RESYNC_DAYS = 5
export const TOP_ROWS = 500
export const TOP_WINDOW_DAYS = 28
export const TOP_SNAPSHOT_EVERY_DAYS = 7
const CHUNK = 500

const DEVICES = new Set(['desktop', 'mobile', 'tablet'])

export function mapDailyRows(rows: GscRow[], siteId: string, orgId: string): DailyInsert[] {
  const out: DailyInsert[] = []
  for (const r of rows) {
    const [date, rawDevice] = r.keys ?? []
    const device = (rawDevice ?? '').toLowerCase()
    if (!date || !DEVICES.has(device)) continue
    out.push({
      org_id: orgId,
      site_id: siteId,
      date,
      device: device as DailyInsert['device'],
      clicks: Math.round(r.clicks),
      impressions: Math.round(r.impressions),
      ctr: r.ctr,
      position: r.position,
    })
  }
  return out
}

export function mapTopRows(
  rows: GscRow[],
  dimension: 'query' | 'page',
  siteId: string,
  orgId: string,
  windowEnd: string,
): TopInsert[] {
  return rows
    .filter((r) => r.keys?.[0])
    .map((r) => ({
      org_id: orgId,
      site_id: siteId,
      window_end: windowEnd,
      dimension,
      key: r.keys![0].slice(0, 2000),
      clicks: Math.round(r.clicks),
      impressions: Math.round(r.impressions),
      ctr: r.ctr,
      position: r.position,
    }))
}

/** A new top snapshot is due when none exists or the newest is a week old. */
export function topSnapshotDue(latestWindowEnd: string | null, windowEnd: string): boolean {
  return !latestWindowEnd || daysBetween(latestWindowEnd, windowEnd) >= TOP_SNAPSHOT_EVERY_DAYS
}

/** Date range for this sync: full backfill the first time, a short tail after. */
export function syncRange(today: string, backfilled: boolean): { startDate: string; endDate: string } {
  const endDate = addDays(today, -1)
  return {
    startDate: backfilled ? addDays(endDate, -(RESYNC_DAYS - 1)) : addMonths(endDate, -BACKFILL_MONTHS),
    endDate,
  }
}

export async function syncSite(sb: Sb, site: SiteRow, token: string, now = new Date()) {
  const property = site.gsc_property!
  const backfilled = Boolean(site.gsc_backfilled_at)
  const { startDate, endDate } = syncRange(isoDate(now), backfilled)

  if (!backfilled) {
    // First sync for this property (or the property changed): start clean.
    await sb.from('seo_gsc_daily').delete().eq('site_id', site.id)
    await sb.from('seo_gsc_top').delete().eq('site_id', site.id)
  }

  const daily = mapDailyRows(
    await querySearchAnalytics(token, property, { startDate, endDate, dimensions: ['date', 'device'], dataState: 'all' }),
    site.id,
    site.org_id,
  )
  for (let i = 0; i < daily.length; i += CHUNK) {
    const { error } = await sb.from('seo_gsc_daily').upsert(daily.slice(i, i + CHUNK), { onConflict: 'site_id,date,device' })
    if (error) throw new Error(`seo_gsc_daily upsert failed: ${error.message}`)
  }

  const { data: latest } = await sb
    .from('seo_gsc_top')
    .select('window_end')
    .eq('site_id', site.id)
    .order('window_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  let topRows = 0
  if (topSnapshotDue(latest?.window_end ?? null, endDate)) {
    const windowStart = addDays(endDate, -(TOP_WINDOW_DAYS - 1))
    const [queries, pages] = await Promise.all(
      (['query', 'page'] as const).map((dimension) =>
        querySearchAnalytics(token, property, { startDate: windowStart, endDate, dimensions: [dimension], rowLimit: TOP_ROWS, dataState: 'all' }),
      ),
    )
    const rows = [
      ...mapTopRows(queries, 'query', site.id, site.org_id, endDate),
      ...mapTopRows(pages, 'page', site.id, site.org_id, endDate),
    ]
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await sb.from('seo_gsc_top').upsert(rows.slice(i, i + CHUNK), { onConflict: 'site_id,window_end,dimension,key' })
      if (error) throw new Error(`seo_gsc_top upsert failed: ${error.message}`)
    }
    topRows = rows.length
  }

  return { dailyRows: daily.length, topRows, backfill: !backfilled }
}

export interface GscSyncResult {
  claimed: number
  synced: Array<{ siteId: string; dailyRows: number; topRows: number; backfill: boolean }>
  failed: Array<{ siteId: string; error: string }>
}

export async function runGscSyncs(sb: Sb): Promise<GscSyncResult> {
  const result: GscSyncResult = { claimed: 0, synced: [], failed: [] }
  const { data: claimed, error } = await sb.rpc('claim_gsc_syncs', { p_limit: GSC_SITES_PER_TICK })
  if (error) {
    console.error('[seo-tick] claim_gsc_syncs failed:', error.message)
    return result
  }
  const sites = (Array.isArray(claimed) ? claimed : []) as SiteRow[]
  result.claimed = sites.length
  const tokens = new Map<string, Promise<string>>()

  for (const site of sites) {
    try {
      if (!tokens.has(site.org_id)) tokens.set(site.org_id, getGscAccessToken(sb, site.org_id))
      const token = await tokens.get(site.org_id)!
      const out = await syncSite(sb, site, token)
      const now = new Date()
      await sb
        .from('seo_sites')
        .update({
          gsc_synced_at: now.toISOString(),
          gsc_next_sync_at: new Date(now.getTime() + 20 * 3_600_000).toISOString(),
          gsc_last_error: null,
          ...(out.backfill ? { gsc_backfilled_at: now.toISOString() } : {}),
        })
        .eq('id', site.id)
        // The property may have been changed while this sync ran; let the next tick restart it.
        .eq('gsc_property', site.gsc_property!)
      result.synced.push({ siteId: site.id, ...out })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Not connected: retry in 6h (a reconnect resets it). Permission/API errors: 1h.
      const retryHours = err instanceof GscNotConnectedError ? 6 : err instanceof GscApiError && err.status === 403 ? 6 : 1
      await sb
        .from('seo_sites')
        .update({
          gsc_last_error: message.slice(0, 500),
          gsc_next_sync_at: new Date(Date.now() + retryHours * 3_600_000).toISOString(),
        })
        .eq('id', site.id)
      result.failed.push({ siteId: site.id, error: message })
    }
  }

  if (sites.length) {
    const { error: pruneError } = await sb.rpc('prune_seo_gsc_top', {})
    if (pruneError) console.error('[seo-tick] prune_seo_gsc_top failed:', pruneError.message)
  }
  return result
}

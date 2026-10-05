import 'server-only'

// Scan creation — the single entry point for every caller (dashboard, cron
// schedules, workflows, MCP). Estimates the cost, enforces the points quota,
// then writes the scan, its grid points and the usage-ledger charge.

import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { pickProviderId, providerProfile } from './credentials'
import { buildGrid } from './grid'
import { checkPointsQuota, periodStart, type QuotaSnapshot } from './quota'
import {
  DEFAULT_DEPTH,
  DEFAULT_ZOOM,
  GRID_SIZES,
  type GridShape,
  type ProviderId,
  type ScanTrigger,
} from './types'

type Admin = SupabaseClient<Database>

export type ScanParams = {
  orgId: string
  locationId: string
  keywordId: string
  gridSize?: number
  spacingM?: number
  shape?: GridShape
  zoom?: number
  triggeredBy: ScanTrigger
  userId?: string | null
  scheduleId?: string | null
}

export type ScanEstimate = {
  provider: ProviderId
  points: number
  costUsd: number
  billable: boolean
  quota: QuotaSnapshot
}

export type CreateScanResult =
  | { ok: true; scanId: string; estimate: ScanEstimate }
  | { ok: false; error: string; estimate?: ScanEstimate }

export function comparableKey(input: {
  keyword: string
  language: string
  country: string
  gridSize: number
  spacingM: number
  shape: GridShape
  zoom: number
  depth: number
  centerLat: number
  centerLng: number
  provider: ProviderId
}): string {
  const canonical = JSON.stringify([
    input.keyword.trim().toLowerCase(),
    input.language,
    input.country,
    input.gridSize,
    input.spacingM,
    input.shape,
    input.zoom,
    input.depth,
    input.centerLat.toFixed(5),
    input.centerLng.toFixed(5),
    input.provider,
  ])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

async function loadContext(admin: Admin, p: ScanParams) {
  const [{ data: location }, { data: keyword }] = await Promise.all([
    admin
      .from('local_seo_locations')
      .select('id, org_id, lat, lng, language, country, default_grid_size, default_spacing_m, default_shape, is_active')
      .eq('id', p.locationId)
      .eq('org_id', p.orgId)
      .maybeSingle(),
    admin
      .from('local_seo_keywords')
      .select('id, keyword, language, country, location_id, is_active')
      .eq('id', p.keywordId)
      .eq('org_id', p.orgId)
      .maybeSingle(),
  ])
  if (!location) return { error: 'Location not found.' as const }
  if (!location.is_active) return { error: 'This location is paused.' as const }
  if (!keyword || keyword.location_id !== location.id) return { error: 'Keyword not found for this location.' as const }
  const gridSize = p.gridSize ?? location.default_grid_size
  if (!(GRID_SIZES as readonly number[]).includes(gridSize)) return { error: `Unsupported grid size ${gridSize}.` as const }
  const spacingM = p.spacingM ?? location.default_spacing_m
  if (!(spacingM >= 100 && spacingM <= 20000)) return { error: 'Grid spacing must be between 100 m and 20 km.' as const }
  const shape = p.shape ?? location.default_shape
  return {
    location,
    keyword,
    gridSize,
    spacingM,
    shape,
    zoom: p.zoom ?? DEFAULT_ZOOM,
    language: keyword.language ?? location.language,
    country: keyword.country ?? location.country,
  }
}

export async function estimateScan(admin: Admin, p: ScanParams): Promise<{ ok: true; estimate: ScanEstimate } | { ok: false; error: string }> {
  const ctx = await loadContext(admin, p)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const provider = await pickProviderId(admin)
  if (!provider) return { ok: false, error: 'No rank provider is configured. Ask the platform admin to add a DataForSEO or SerpAPI key.' }
  const points = buildGrid({ centerLat: ctx.location.lat, centerLng: ctx.location.lng, size: ctx.gridSize, spacingM: ctx.spacingM, shape: ctx.shape }).length
  const billable = provider !== 'fake'
  const check = await checkPointsQuota(admin, p.orgId, billable ? points : 0)
  return {
    ok: true,
    estimate: { provider, points, costUsd: points * providerProfile(provider).costPerPointUsd, billable, quota: check.quota },
  }
}

export async function createScan(admin: Admin, p: ScanParams): Promise<CreateScanResult> {
  const ctx = await loadContext(admin, p)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }

  const provider = await pickProviderId(admin)
  if (!provider) {
    return { ok: false, error: 'No rank provider is configured. Ask the platform admin to add a DataForSEO or SerpAPI key.' }
  }
  const profile = providerProfile(provider)
  const grid = buildGrid({
    centerLat: ctx.location.lat,
    centerLng: ctx.location.lng,
    size: ctx.gridSize,
    spacingM: ctx.spacingM,
    shape: ctx.shape,
  })
  const billable = provider !== 'fake'
  const check = await checkPointsQuota(admin, p.orgId, billable ? grid.length : 0)
  const estimate: ScanEstimate = {
    provider,
    points: grid.length,
    costUsd: grid.length * profile.costPerPointUsd,
    billable,
    quota: check.quota,
  }
  if (!check.ok) return { ok: false, error: check.error, estimate }

  const { data: scan, error: scanErr } = await admin
    .from('local_seo_scans')
    .insert({
      org_id: p.orgId,
      location_id: ctx.location.id,
      keyword_id: ctx.keyword.id,
      keyword: ctx.keyword.keyword,
      language: ctx.language,
      country: ctx.country,
      schedule_id: p.scheduleId ?? null,
      provider,
      provider_mode: profile.mode,
      grid_size: ctx.gridSize,
      spacing_m: ctx.spacingM,
      shape: ctx.shape,
      zoom: ctx.zoom,
      depth: DEFAULT_DEPTH,
      center_lat: ctx.location.lat,
      center_lng: ctx.location.lng,
      comparable_key: comparableKey({
        keyword: ctx.keyword.keyword,
        language: ctx.language,
        country: ctx.country,
        gridSize: ctx.gridSize,
        spacingM: ctx.spacingM,
        shape: ctx.shape,
        zoom: ctx.zoom,
        depth: DEFAULT_DEPTH,
        centerLat: ctx.location.lat,
        centerLng: ctx.location.lng,
        provider,
      }),
      points_total: grid.length,
      est_cost_usd: estimate.costUsd,
      triggered_by: p.triggeredBy,
      triggered_by_user: p.userId ?? null,
    })
    .select('id')
    .single()
  if (scanErr || !scan) return { ok: false, error: `Could not create the scan: ${scanErr?.message ?? 'unknown error'}` }

  const { error: pointsErr } = await admin.from('local_seo_scan_points').insert(
    grid.map((g) => ({ org_id: p.orgId, scan_id: scan.id, row_idx: g.row, col_idx: g.col, lat: g.lat, lng: g.lng })),
  )
  if (pointsErr) {
    await admin.from('local_seo_scans').delete().eq('id', scan.id)
    return { ok: false, error: `Could not create the scan points: ${pointsErr.message}` }
  }

  const { error: ledgerErr } = await admin.from('local_seo_usage_ledger').insert({
    org_id: p.orgId,
    scan_id: scan.id,
    points: grid.length,
    cost_usd: estimate.costUsd,
    provider,
    billable,
    period: periodStart(),
  })
  if (ledgerErr) {
    // Never run an unmetered scan.
    await admin.from('local_seo_scans').delete().eq('id', scan.id)
    return { ok: false, error: `Could not record usage: ${ledgerErr.message}` }
  }

  return { ok: true, scanId: scan.id, estimate }
}

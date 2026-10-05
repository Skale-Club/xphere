'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'

import { requireFeature } from '@/lib/billing/guards'
import { businessSearchKey } from '@/lib/local-seo/credentials'
import { cidFromDataId } from '@/lib/local-seo/providers/serpapi'
import { estimateScan, createScan, type ScanEstimate } from '@/lib/local-seo/scans'
import { GRID_SIZES } from '@/lib/local-seo/types'
import { runLocalSeoTick } from '@/lib/local-seo/worker'
import { requirePermission } from '@/lib/rbac/server'
import { SerpApiClient, isSerpApiError } from '@/lib/serpapi/client'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient, getUser } from '@/lib/supabase/server'

type Fail = { error: string }

type Ctx = {
  user: { id: string }
  supabase: Awaited<ReturnType<typeof createClient>>
  orgId: string
}

async function context(permission: 'local_seo.view' | 'local_seo.manage'): Promise<Ctx | Fail> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const perm = await requirePermission(permission)
  if (!perm.ok) return { error: perm.error ?? 'You do not have permission to do this.' }
  const feature = await requireFeature('local_seo')
  if (!feature.ok) return { error: feature.error }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }
  return { user, supabase, orgId: orgId as string }
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export type BusinessCandidate = {
  placeId: string
  cid: string | null
  title: string
  address: string | null
  lat: number
  lng: number
  rating: number | null
  reviews: number | null
  category: string | null
}

export async function searchBusinessCandidates(input: {
  query: string
  near?: string
}): Promise<{ results: BusinessCandidate[] } | Fail> {
  const ctx = await context('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const query = input.query.trim()
  if (query.length < 2) return { error: 'Type at least 2 characters.' }

  const key = await businessSearchKey(createServiceRoleClient(), ctx.orgId)
  if (!key) return { error: 'No SerpAPI key is configured for the business search. Ask the platform admin to add one.' }
  try {
    const places = await new SerpApiClient(key).searchBusinesses(query, input.near)
    const results = places
      .filter((p) => p.place_id && p.gps_coordinates?.latitude != null && p.gps_coordinates?.longitude != null)
      .slice(0, 10)
      .map((p) => ({
        placeId: p.place_id!,
        cid: cidFromDataId(p.data_id),
        title: p.title ?? 'Unnamed business',
        address: p.address ?? null,
        lat: p.gps_coordinates!.latitude!,
        lng: p.gps_coordinates!.longitude!,
        rating: p.rating ?? null,
        reviews: p.reviews ?? null,
        category: p.type ?? p.types?.[0] ?? null,
      }))
    return { results }
  } catch (err) {
    return { error: isSerpApiError(err) ? err.message : 'Business search failed.' }
  }
}

const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  placeId: z.string().trim().min(1),
  cid: z.string().nullable(),
  businessName: z.string().trim().min(1).max(200),
  address: z.string().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z.string().nullable(),
  rating: z.number().nullable(),
  reviews: z.number().int().nullable(),
  language: z.string().trim().min(2).max(8),
  country: z.string().trim().length(2),
  keywords: z.array(z.string().trim().min(1).max(200)).max(50),
})

export async function createLocation(
  input: z.infer<typeof createLocationSchema>,
): Promise<{ id: string } | Fail> {
  const ctx = await context('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const parsed = createLocationSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid location.' }
  const v = parsed.data

  // Link the reviews profile for the same place, when the org has one.
  const { data: reviewProfile } = await ctx.supabase
    .from('google_business_profiles')
    .select('id')
    .eq('place_id', v.placeId)
    .maybeSingle()

  const { data: location, error } = await ctx.supabase
    .from('local_seo_locations')
    .insert({
      org_id: ctx.orgId,
      name: v.name,
      business_name: v.businessName,
      place_id: v.placeId,
      cid: v.cid,
      address: v.address,
      lat: v.lat,
      lng: v.lng,
      primary_category: v.category,
      rating: v.rating,
      reviews_count: v.reviews,
      language: v.language.toLowerCase(),
      country: v.country.toLowerCase(),
      google_business_profile_id: reviewProfile?.id ?? null,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return { error: 'This business is already tracked in this organization.' }
    return { error: error.message }
  }

  const keywords = dedupeKeywords(v.keywords)
  if (keywords.length) {
    await ctx.supabase
      .from('local_seo_keywords')
      .insert(keywords.map((keyword) => ({ org_id: ctx.orgId, location_id: location.id, keyword })))
  }
  revalidatePath('/local-seo')
  return { id: location.id }
}

const updateLocationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  language: z.string().trim().min(2).max(8),
  country: z.string().trim().length(2),
  defaultGridSize: z.number().refine((n) => (GRID_SIZES as readonly number[]).includes(n), 'Unsupported grid size'),
  defaultSpacingM: z.number().int().min(100).max(20000),
  defaultShape: z.enum(['square', 'circle']),
  googleBusinessProfileId: z.string().uuid().nullable(),
  isActive: z.boolean(),
})

export async function updateLocation(
  locationId: string,
  input: z.infer<typeof updateLocationSchema>,
): Promise<{ ok: true } | Fail> {
  const ctx = await context('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const parsed = updateLocationSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings.' }
  const v = parsed.data
  const { error } = await ctx.supabase
    .from('local_seo_locations')
    .update({
      name: v.name,
      language: v.language.toLowerCase(),
      country: v.country.toLowerCase(),
      default_grid_size: v.defaultGridSize,
      default_spacing_m: v.defaultSpacingM,
      default_shape: v.defaultShape,
      google_business_profile_id: v.googleBusinessProfileId,
      is_active: v.isActive,
    })
    .eq('id', locationId)
  if (error) return { error: error.message }
  revalidatePath('/local-seo')
  revalidatePath(`/local-seo/${locationId}`, 'layout')
  return { ok: true }
}

export async function deleteLocation(locationId: string): Promise<{ ok: true } | Fail> {
  const ctx = await context('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const { error } = await ctx.supabase.from('local_seo_locations').delete().eq('id', locationId)
  if (error) return { error: error.message }
  revalidatePath('/local-seo')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

function dedupeKeywords(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const k = raw.trim().replace(/\s+/g, ' ')
    if (!k || seen.has(k.toLowerCase())) continue
    seen.add(k.toLowerCase())
    out.push(k)
  }
  return out
}

export async function addKeywords(locationId: string, keywords: string[]): Promise<{ added: number } | Fail> {
  const ctx = await context('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const list = dedupeKeywords(keywords).filter((k) => k.length <= 200)
  if (!list.length) return { error: 'Enter at least one keyword.' }

  const { data: existing } = await ctx.supabase
    .from('local_seo_keywords')
    .select('keyword')
    .eq('location_id', locationId)
  const have = new Set((existing ?? []).map((k) => k.keyword.toLowerCase()))
  const fresh = list.filter((k) => !have.has(k.toLowerCase()))
  if (!fresh.length) return { added: 0 }
  const { error } = await ctx.supabase
    .from('local_seo_keywords')
    .insert(fresh.map((keyword) => ({ org_id: ctx.orgId, location_id: locationId, keyword })))
  if (error) return { error: error.message }
  revalidatePath(`/local-seo/${locationId}`, 'layout')
  return { added: fresh.length }
}

export async function deleteKeyword(keywordId: string, locationId: string): Promise<{ ok: true } | Fail> {
  const ctx = await context('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const { error } = await ctx.supabase.from('local_seo_keywords').delete().eq('id', keywordId)
  if (error) return { error: error.message }
  revalidatePath(`/local-seo/${locationId}`, 'layout')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

const scanSchema = z.object({
  locationId: z.string().uuid(),
  keywordIds: z.array(z.string().uuid()).min(1).max(20),
  gridSize: z.number().optional(),
  spacingM: z.number().int().optional(),
  shape: z.enum(['square', 'circle']).optional(),
})

export type ScanEstimateView = ScanEstimate & { scans: number; totalPoints: number; totalCostUsd: number }

export async function estimateScans(input: z.infer<typeof scanSchema>): Promise<{ estimate: ScanEstimateView } | Fail> {
  const ctx = await context('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const parsed = scanSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid scan settings.' }
  const v = parsed.data
  const res = await estimateScan(createServiceRoleClient(), {
    orgId: ctx.orgId,
    locationId: v.locationId,
    keywordId: v.keywordIds[0],
    gridSize: v.gridSize,
    spacingM: v.spacingM,
    shape: v.shape,
    triggeredBy: 'manual',
  })
  if (!res.ok) return { error: res.error }
  const scans = v.keywordIds.length
  return {
    estimate: {
      ...res.estimate,
      scans,
      totalPoints: res.estimate.points * scans,
      totalCostUsd: res.estimate.costUsd * scans,
    },
  }
}

export async function runScans(input: z.infer<typeof scanSchema>): Promise<{ scanIds: string[]; error?: string } | Fail> {
  const ctx = await context('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const parsed = scanSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid scan settings.' }
  const v = parsed.data
  const admin = createServiceRoleClient()

  const scanIds: string[] = []
  let lastError: string | undefined
  for (const keywordId of v.keywordIds) {
    const res = await createScan(admin, {
      orgId: ctx.orgId,
      locationId: v.locationId,
      keywordId,
      gridSize: v.gridSize,
      spacingM: v.spacingM,
      shape: v.shape,
      triggeredBy: 'manual',
      userId: ctx.user.id,
    })
    if (res.ok) scanIds.push(res.scanId)
    else {
      lastError = res.error
      break // quota errors apply to every following keyword too
    }
  }
  if (!scanIds.length) return { error: lastError ?? 'The scan could not be started.' }

  // Start right away instead of waiting for the next cron minute.
  after(async () => {
    try {
      await runLocalSeoTick(createServiceRoleClient(), { budgetMs: 50_000 })
    } catch {
      // The cron tick picks the scan up.
    }
  })
  revalidatePath(`/local-seo/${v.locationId}`, 'layout')
  return { scanIds, error: lastError }
}

export type PointDetail = {
  rank: number | null
  status: string
  lastError: string | null
  results: { position: number; title: string; rating: number | null; reviews: number | null; category: string | null; address: string | null; isTarget: boolean }[]
  truncated: boolean
}

export async function getPointDetail(pointId: string): Promise<PointDetail | Fail> {
  const ctx = await context('local_seo.view')
  if ('error' in ctx) return { error: ctx.error }
  const [{ data: point }, { data: results }] = await Promise.all([
    ctx.supabase.from('local_seo_scan_points').select('rank, status, last_error, top3').eq('id', pointId).maybeSingle(),
    ctx.supabase
      .from('local_seo_serp_results')
      .select('position, title, rating, reviews, category, address, is_target')
      .eq('point_id', pointId)
      .order('position', { ascending: true }),
  ])
  if (!point) return { error: 'Point not found.' }
  if (results?.length) {
    return {
      rank: point.rank,
      status: point.status,
      lastError: point.last_error,
      truncated: false,
      results: results.map((r) => ({ ...r, isTarget: r.is_target })),
    }
  }
  // Full results pruned after 60 days: fall back to the stored top 3.
  const top3 = (Array.isArray(point.top3) ? point.top3 : []) as { position: number; title: string }[]
  return {
    rank: point.rank,
    status: point.status,
    lastError: point.last_error,
    truncated: top3.length > 0,
    results: top3.map((t) => ({ position: t.position, title: t.title, rating: null, reviews: null, category: null, address: null, isTarget: false })),
  }
}

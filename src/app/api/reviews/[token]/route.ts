// src/app/api/reviews/[token]/route.ts
// Public widget endpoint | no authentication, scoped by widget_token.
// Powers the embeddable <iframe> on client sites.
//
// Query params:
//   min_rating  1..5  (default: 1)
//   sort        recent | rating_high | helpful  (default: recent)
//   limit       1..50 (default: 10)
//   offset      0+    (default: 0)
//   layout      grid | list | carousel  (passed through to the widget JS)

import { createServiceRoleClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  Vary: 'Origin',
} as const

const CACHE_HEADERS = {
  'Cache-Control': 'no-store',
} as const

type WidgetSettingsPayload = {
  layout: 'grid' | 'list' | 'carousel'
  theme: 'light' | 'dark'
  minRating: number
  limit: number
  showHero: boolean
  equalHeight: boolean
  footerCta: boolean
}

type ProfileRow = {
  id: string
  org_id: string
  place_id: string
  business_name: string | null
  address: string | null
  average_rating: number | null
  total_reviews_count: number | null
  last_scraped_at: string | null
  widget_settings: unknown
}

type OrganizationRow = {
  accent_color: string | null
}

type ReviewRow = {
  id: string
  reviewer_name: string | null
  reviewer_photo_url: string | null
  reviewer_profile_url: string | null
  rating: number
  text: string | null
  date_text: string | null
  date_iso: string | null
  is_local_guide: boolean
  helpful_count: number
  owner_response: string | null
  owner_response_date: string | null
}

type ReviewPhotoRow = {
  review_id: string
  position: number
  original_url: string
  hetzner_url: string | null
  width: number | null
  height: number | null
}

type WidgetPayload = {
  business: {
    name: string | null
    address: string | null
    placeId: string | null
    averageRating: number | null
    totalReviewsCount: number | null
    lastScrapedAt: string | null
  }
  brand: {
    accent: string
  }
  settings: WidgetSettingsPayload
  distribution: { rating: number; count: number }[]
  reviews: Array<{
    id: string
    reviewerName: string | null
    reviewerPhotoUrl: string | null
    reviewerProfileUrl: string | null
    rating: number
    text: string | null
    dateText: string | null
    dateIso: string | null
    isLocalGuide: boolean
    helpfulCount: number
    ownerResponse: string | null
    ownerResponseDate: string | null
    photos: {
      url: string
      width: number | null
      height: number | null
    }[]
  }>
  total: number
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function resolveAccent(raw: string | null | undefined): string {
  return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#6366F1'
}

function readStringSetting(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

function readBooleanSetting(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key]
  return typeof value === 'boolean' ? value : fallback
}

function normalizeWidgetSettings(raw: unknown): WidgetSettingsPayload {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
  const layout = readStringSetting(source, 'layout')
  const theme = readStringSetting(source, 'theme')
  const limit = readStringSetting(source, 'limit')

  return {
    layout: layout === 'grid' || layout === 'list' ? layout : 'carousel',
    theme: theme === 'dark' ? 'dark' : 'light',
    minRating: clampInt(readStringSetting(source, 'minRating') ?? null, 1, 5, 4),
    limit: limit === 'all' ? 500 : clampInt(limit ?? null, 1, 500, 12),
    showHero: readBooleanSetting(source, 'showHero', true),
    equalHeight: readBooleanSetting(source, 'equalHeight', true),
    footerCta: readBooleanSetting(source, 'footerCta', false),
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params
  if (!token) {
    return Response.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS })
  }

  const url = new URL(request.url)
  const sort = (url.searchParams.get('sort') ?? 'recent') as 'recent' | 'rating_high' | 'helpful'
  const queryMinRating = clampInt(url.searchParams.get('min_rating'), 1, 5, 1)
  const queryLimit = clampInt(url.searchParams.get('limit'), 1, 500, 10)
  const offset = clampInt(url.searchParams.get('offset'), 0, 1000, 0)
  const useSavedSettings = url.searchParams.get('settings') === '1'

  const supabase = createServiceRoleClient()

  const { data: profile, error: profileErr } = await supabase
    .from('google_business_profiles')
    .select('id, org_id, place_id, business_name, address, average_rating, total_reviews_count, last_scraped_at, widget_settings')
    .eq('widget_token', token)
    .eq('is_active', true)
    .single<ProfileRow>()

  if (profileErr || !profile) {
    return Response.json({ error: 'Not found' }, { status: 404, headers: CORS_HEADERS })
  }

  const savedSettings = normalizeWidgetSettings(profile.widget_settings)
  const minRating = useSavedSettings ? savedSettings.minRating : queryMinRating
  const limit = useSavedSettings ? savedSettings.limit : queryLimit

  const { data: organization } = await supabase
    .from('organizations')
    .select('accent_color')
    .eq('id', profile.org_id)
    .maybeSingle<OrganizationRow>()

  // Build query
  let query = supabase
    .from('google_reviews')
    .select(
      'id, reviewer_name, reviewer_photo_url, reviewer_profile_url, rating, text, date_text, date_iso, is_local_guide, helpful_count, owner_response, owner_response_date',
      { count: 'exact' }
    )
    .eq('profile_id', profile.id)
    .eq('is_removed', false)
    .gte('rating', minRating)

  if (sort === 'rating_high') {
    query = query.order('rating', { ascending: false }).order('date_iso', { ascending: false, nullsFirst: false })
  } else if (sort === 'helpful') {
    query = query.order('helpful_count', { ascending: false })
  } else {
    query = query.order('date_iso', { ascending: false, nullsFirst: false }).order('first_seen_at', { ascending: false })
  }

  query = query.range(offset, offset + limit - 1)

  const { data: reviews, error: reviewsErr, count } = await query
  if (reviewsErr) {
    return Response.json({ error: 'Failed to load reviews' }, { status: 500, headers: CORS_HEADERS })
  }

  // Load photos in one query
  const reviewIds = (reviews ?? []).map((r) => r.id)
  const photosByReview = new Map<string, ReviewPhotoRow[]>()
  if (reviewIds.length > 0) {
    const { data: photos } = await supabase
      .from('google_review_photos')
      .select('review_id, position, original_url, hetzner_url, width, height')
      .in('review_id', reviewIds)
      .order('position', { ascending: true })
    for (const p of (photos ?? []) as ReviewPhotoRow[]) {
      const arr = photosByReview.get(p.review_id) ?? []
      arr.push(p)
      photosByReview.set(p.review_id, arr)
    }
  }

  // Compute distribution (full active set | independent of filters/pagination)
  const { data: distRows } = await supabase
    .from('google_reviews')
    .select('rating')
    .eq('profile_id', profile.id)
    .eq('is_removed', false)
  const distMap = new Map<number, number>([
    [5, 0], [4, 0], [3, 0], [2, 0], [1, 0],
  ])
  for (const r of distRows ?? []) {
    distMap.set(r.rating, (distMap.get(r.rating) ?? 0) + 1)
  }

  const payload: WidgetPayload = {
    business: {
      name: profile.business_name,
      address: profile.address,
      placeId: profile.place_id && profile.place_id !== '__pending__' ? profile.place_id : null,
      averageRating: profile.average_rating,
      totalReviewsCount: profile.total_reviews_count,
      lastScrapedAt: profile.last_scraped_at,
    },
    brand: {
      accent: resolveAccent(organization?.accent_color),
    },
    settings: savedSettings,
    distribution: [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: distMap.get(r) ?? 0 })),
    reviews: ((reviews ?? []) as ReviewRow[]).map((r) => ({
      id: r.id,
      reviewerName: r.reviewer_name,
      reviewerPhotoUrl: r.reviewer_photo_url,
      reviewerProfileUrl: r.reviewer_profile_url,
      rating: r.rating,
      text: r.text,
      dateText: r.date_text,
      dateIso: r.date_iso,
      isLocalGuide: r.is_local_guide,
      helpfulCount: r.helpful_count,
      ownerResponse: r.owner_response,
      ownerResponseDate: r.owner_response_date,
      photos: (photosByReview.get(r.id) ?? []).map((p) => ({
        url: p.hetzner_url ?? p.original_url,
        width: p.width,
        height: p.height,
      })),
    })),
    total: count ?? 0,
  }

  return Response.json(payload, {
    headers: { ...CORS_HEADERS, ...CACHE_HEADERS },
  })
}

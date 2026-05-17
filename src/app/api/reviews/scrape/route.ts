// src/app/api/reviews/scrape/route.ts
// Bearer-protected runner that loops every active google_business_profile and
// scrapes its reviews via SerpAPI. Triggered daily by .github/workflows/scrape-reviews.yml
// or manually via workflow_dispatch / "Refresh now" button (with ?profileId=...).
//
// Pattern: src/app/api/automations/ghl-reengagement/run/route.ts

import { timingSafeEqual } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { scrapeAllReviews } from '@/lib/serpapi/scrape-reviews'
import { upsertReviews } from '@/lib/serpapi/upsert-reviews'
import { isSerpApiError } from '@/lib/serpapi/client'

export const runtime = 'nodejs'
export const maxDuration = 300

const SECRET_ENV = 'OPERATOR_AUTOMATION_SECRET'

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  const m = header.match(/^Bearer\s+(.+)$/)
  if (!m) return false
  const expected = process.env[SECRET_ENV] ?? ''
  if (!expected) return false
  const provided = Buffer.from(m[1])
  const exp = Buffer.from(expected)
  if (provided.length !== exp.length) return false
  return timingSafeEqual(provided, exp)
}

type ScrapeProfileResult = {
  profileId: string
  placeId: string
  status: 'scraped' | 'skipped' | 'error'
  upserted?: number
  newReviews?: number
  removed?: number
  pagesFetched?: number
  error?: string
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const force = url.searchParams.get('force') === '1'
  const targetProfileId = url.searchParams.get('profileId')

  const supabase = createServiceRoleClient()

  let query = supabase
    .from('google_business_profiles')
    .select('id, org_id, place_id, serpapi_key_encrypted, scrape_interval_hours, last_scraped_at')
    .eq('is_active', true)

  if (targetProfileId) query = query.eq('id', targetProfileId)

  const { data: profiles, error: profilesErr } = await query
  if (profilesErr) {
    return Response.json({ error: profilesErr.message }, { status: 500 })
  }

  const results: ScrapeProfileResult[] = []
  let scraped = 0
  let skipped = 0
  const errors: { profileId: string; message: string }[] = []

  for (const profile of profiles ?? []) {
    // Honor scrape_interval_hours unless force or single-target invocation
    if (!force && !targetProfileId && profile.last_scraped_at) {
      const elapsedMs = Date.now() - new Date(profile.last_scraped_at).getTime()
      const intervalMs = profile.scrape_interval_hours * 60 * 60 * 1000
      if (elapsedMs < intervalMs) {
        results.push({ profileId: profile.id, placeId: profile.place_id, status: 'skipped' })
        skipped += 1
        continue
      }
    }

    const scrapeStartedAt = new Date().toISOString()
    try {
      const apiKey = await decrypt(profile.serpapi_key_encrypted)
      const { reviews, placeInfo, pagesFetched } = await scrapeAllReviews(apiKey, profile.place_id)
      const summary = await upsertReviews(supabase, {
        orgId: profile.org_id,
        profileId: profile.id,
        scrapeStartedAt,
        reviews,
      })

      await supabase
        .from('google_business_profiles')
        .update({
          last_scraped_at: new Date().toISOString(),
          last_scrape_status: 'success',
          last_scrape_error: null,
          total_reviews_count: placeInfo?.reviews ?? summary.totalReviewsCount,
          average_rating: placeInfo?.rating ?? summary.averageRating,
          business_name: placeInfo?.title ?? undefined,
          address: placeInfo?.address ?? undefined,
        })
        .eq('id', profile.id)

      results.push({
        profileId: profile.id,
        placeId: profile.place_id,
        status: 'scraped',
        upserted: summary.upserted,
        newReviews: summary.newReviews,
        removed: summary.removed,
        pagesFetched,
      })
      scraped += 1
    } catch (err) {
      const status = isSerpApiError(err)
        ? err.status === 'quota_exceeded'
          ? 'quota_exceeded'
          : 'error'
        : 'error'
      const message =
        isSerpApiError(err) ? err.message : err instanceof Error ? err.message : 'Unknown error'

      await supabase
        .from('google_business_profiles')
        .update({
          last_scraped_at: new Date().toISOString(),
          last_scrape_status: status,
          last_scrape_error: message.slice(0, 500),
        })
        .eq('id', profile.id)

      results.push({
        profileId: profile.id,
        placeId: profile.place_id,
        status: 'error',
        error: message,
      })
      errors.push({ profileId: profile.id, message })
    }
  }

  return Response.json({ scraped, skipped, errors, results })
}

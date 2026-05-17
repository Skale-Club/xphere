// src/lib/serpapi/scrape-reviews.ts
// Paginated scrape of all reviews for one Google Place ID via SerpAPI.
// Used by both the bearer-protected /api/reviews/scrape endpoint (GitHub Action)
// and the per-org "Refresh now" button in the integration UI.

import { SerpApiClient, type SerpApiReview, type SerpApiReviewsResponse } from './client'

export type ScrapeResult = {
  reviews: SerpApiReview[]
  placeInfo: SerpApiReviewsResponse['place_info']
  pagesFetched: number
}

export type ScrapeOptions = {
  maxPages?: number
  hl?: string
  gl?: string
}

const DEFAULT_MAX_PAGES = 10 // 10 pages × 10 reviews = 100 reviews on first pass

/**
 * Walk through SerpAPI pages for `placeId` until either:
 *   - `next_page_token` is absent
 *   - we reach `maxPages`
 *
 * Each page consumes one SerpAPI search from the org's free-tier quota.
 */
export async function scrapeAllReviews(
  apiKey: string,
  placeId: string,
  opts: ScrapeOptions = {}
): Promise<ScrapeResult> {
  const client = new SerpApiClient(apiKey)
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
  const all: SerpApiReview[] = []
  let token: string | null = null
  let pages = 0
  let placeInfo: SerpApiReviewsResponse['place_info'] = undefined

  while (pages < maxPages) {
    const res = await client.fetchReviews(placeId, token, { hl: opts.hl, gl: opts.gl })
    pages += 1
    if (res.place_info && !placeInfo) placeInfo = res.place_info
    const page = res.reviews ?? []
    all.push(...page)

    const next = res.serpapi_pagination?.next_page_token ?? null
    if (!next || page.length === 0) break
    token = next
  }

  return { reviews: all, placeInfo, pagesFetched: pages }
}

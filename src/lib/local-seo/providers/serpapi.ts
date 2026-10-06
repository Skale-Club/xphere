// SerpAPI Google Maps engine as a sync rank provider. One search per point:
// engine=google_maps&type=search&q=<keyword>&ll=@lat,lng,<zoom>z returns up to
// 20 organic local results (ads come back in a separate `ads` array and are
// ignored, like Google's own "rank" excludes them).

import type { SerpResult } from '../types'
import { RankProviderError, type PointQuery, type SyncRankProvider } from './types'
import { placeCategory } from '@/lib/serpapi/client'

const SERPAPI_BASE = 'https://serpapi.com/search.json'
// Developer plan: US$75 / 5,000 searches (Oct 2026). Used for cost tracking.
const COST_PER_SEARCH_USD = 0.015

type SerpApiLocalResult = {
  position?: number
  title?: string
  place_id?: string
  data_id?: string
  data_cid?: string | number
  rating?: number
  reviews?: number
  /** A string in local_results; an array of categories in place_results. */
  type?: string | string[]
  address?: string
  phone?: string
  gps_coordinates?: { latitude?: number; longitude?: number }
}

/** data_id is "0x<feature>:0x<cid-in-hex>"; the second half is Google's CID. */
export function cidFromDataId(dataId: string | undefined): string | null {
  const hex = dataId?.split(':')[1]
  if (!hex || !/^0x[0-9a-f]+$/i.test(hex)) return null
  try {
    return BigInt(hex).toString(10)
  } catch {
    return null
  }
}

export function parseSerpApiMaps(json: unknown, depth: number): SerpResult[] {
  const body = (json ?? {}) as { local_results?: SerpApiLocalResult[]; place_results?: SerpApiLocalResult }
  // A query that resolves to a single business returns place_results instead.
  const list = body.local_results ?? (body.place_results ? [{ ...body.place_results, position: 1 }] : [])
  return list
    .map((r, i): SerpResult => ({
      position: typeof r.position === 'number' ? r.position : i + 1,
      title: r.title ?? '',
      placeId: r.place_id ?? null,
      cid: r.data_cid != null ? String(r.data_cid) : cidFromDataId(r.data_id),
      rating: typeof r.rating === 'number' ? r.rating : null,
      reviews: typeof r.reviews === 'number' ? r.reviews : null,
      category: placeCategory(r),
      address: r.address ?? null,
      phone: r.phone ?? null,
      lat: r.gps_coordinates?.latitude ?? null,
      lng: r.gps_coordinates?.longitude ?? null,
    }))
    .filter((r) => r.title && r.position <= depth)
}

export function createSerpApiProvider(apiKey: string): SyncRankProvider {
  return {
    id: 'serpapi',
    mode: 'sync',
    costPerPointUsd: (depth) => COST_PER_SEARCH_USD * Math.max(1, Math.ceil(depth / 20)),
    async fetchPoint(q: PointQuery) {
      const params = new URLSearchParams({
        engine: 'google_maps',
        type: 'search',
        q: q.keyword,
        ll: `@${q.lat},${q.lng},${q.zoom}z`,
        hl: q.language,
        gl: q.country,
        api_key: apiKey,
      })
      let res: Response
      try {
        res = await fetch(`${SERPAPI_BASE}?${params.toString()}`, { signal: AbortSignal.timeout(45_000) })
      } catch (err) {
        throw new RankProviderError('transient', `SerpAPI request failed: ${(err as Error).message}`)
      }
      if (res.status === 401) throw new RankProviderError('auth', 'SerpAPI rejected the API key.')
      if (res.status === 429) throw new RankProviderError('quota', 'SerpAPI quota or rate limit exceeded.')
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok || json?.error) {
        const msg = json?.error ?? `SerpAPI returned ${res.status}`
        if (/run out of searches/i.test(msg)) throw new RankProviderError('quota', msg)
        // "Google hasn't returned any results" is a valid empty point, not an error.
        if (/hasn't returned any results/i.test(msg)) return []
        throw new RankProviderError(res.status >= 500 ? 'transient' : 'invalid', msg)
      }
      return parseSerpApiMaps(json, q.depth)
    },
  }
}

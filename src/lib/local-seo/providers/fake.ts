// Deterministic offline provider for local development and QA without a paid
// SERP account (LOCAL_SEO_PROVIDER=fake). The tracked business ranks better
// near the grid centre, like a real business does, and the competitors are a
// fixed cast — enough to exercise the map, metrics and competitor views.

import type { SerpResult } from '../types'
import type { PointQuery, SyncRankProvider } from './types'

const CAST = [
  'Northside Studio', 'Main Street Co.', 'Elm & Oak', 'Corner House', 'Riverside Shop',
  'The Local Spot', 'Uptown Experts', 'Prime Choice', 'Golden Hour', 'Bright Works',
  'City Central', 'Harbor Lane', 'Summit Group', 'Blue Door', 'Maple Collective',
  'First Class', 'Union Square', 'Parkview', 'Old Town Pros', 'Westend Partners',
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function createFakeProvider(target: { placeId: string | null; name: string; lat: number; lng: number }): SyncRankProvider {
  return {
    id: 'fake',
    mode: 'sync',
    costPerPointUsd: () => 0,
    async fetchPoint(q: PointQuery): Promise<SerpResult[]> {
      const km = Math.hypot((q.lat - target.lat) * 111.32, (q.lng - target.lng) * 111.32 * Math.cos((q.lat * Math.PI) / 180))
      const jitter = hash(`${q.keyword}|${q.lat}|${q.lng}`) % 4
      const targetRank = Math.round(1 + km * 2.2 + jitter)
      const results: SerpResult[] = []
      let cast = hash(q.keyword) % CAST.length
      for (let pos = 1; pos <= q.depth; pos++) {
        if (pos === targetRank) {
          results.push({ position: pos, title: target.name, placeId: target.placeId, rating: 4.8, reviews: 312 })
          continue
        }
        const title = CAST[cast++ % CAST.length]
        results.push({ position: pos, title, placeId: `fake-${hash(title)}`, rating: 4 + (hash(title) % 10) / 10, reviews: 20 + (hash(title) % 400) })
      }
      return results
    },
  }
}

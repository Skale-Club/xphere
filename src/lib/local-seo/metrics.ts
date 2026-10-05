// Scan metrics. Definitions (SPEC 4.4):
//   ARP   average rank over the points where the business was found
//   ATRP  average rank over all points, a miss counting as depth + 1
//   SoLV  share of points where the business is in the local pack (rank <= 3)
//   found share of points where it ranks at all (rank <= depth)
// Only points that finished (status done) count: a failed point is unknown,
// not a miss, so it never drags the numbers down.

import { DEFAULT_DEPTH, type SerpResult } from './types'
import { competitorKey } from './matching'

export type ScanMetrics = {
  arp: number | null
  atrp: number | null
  solv: number | null
  foundPct: number | null
}

export function computeMetrics(ranks: (number | null)[], depth = DEFAULT_DEPTH): ScanMetrics {
  const n = ranks.length
  if (n === 0) return { arp: null, atrp: null, solv: null, foundPct: null }
  const found = ranks.filter((r): r is number => r !== null && r <= depth)
  const arp = found.length ? round2(sum(found) / found.length) : null
  const atrp = round2(sum(ranks.map((r) => (r !== null && r <= depth ? r : depth + 1))) / n)
  const solv = round2((ranks.filter((r) => r !== null && r <= 3).length / n) * 100)
  const foundPct = round2((found.length / n) * 100)
  return { arp, atrp, solv, foundPct }
}

export type CompetitorAggregate = {
  key: string
  placeId: string | null
  title: string
  appearances: number
  avgRank: number
  solv: number
  rating: number | null
  reviews: number | null
  category: string | null
}

/**
 * Aggregates every business seen across a scan's points. `pointResults` holds
 * one array per finished point (an empty array is a point with no results).
 */
export function aggregateCompetitors(pointResults: SerpResult[][]): CompetitorAggregate[] {
  const total = pointResults.length
  if (total === 0) return []
  const byKey = new Map<string, { agg: CompetitorAggregate; ranks: number[]; top3: number }>()
  for (const results of pointResults) {
    const seenHere = new Set<string>()
    for (const r of results) {
      const key = competitorKey(r)
      if (seenHere.has(key)) continue // a business listed twice counts once per point
      seenHere.add(key)
      let entry = byKey.get(key)
      if (!entry) {
        entry = {
          agg: {
            key,
            placeId: r.placeId ?? null,
            title: r.title,
            appearances: 0,
            avgRank: 0,
            solv: 0,
            rating: r.rating ?? null,
            reviews: r.reviews ?? null,
            category: r.category ?? null,
          },
          ranks: [],
          top3: 0,
        }
        byKey.set(key, entry)
      }
      entry.ranks.push(r.position)
      if (r.position <= 3) entry.top3++
      entry.agg.rating ??= r.rating ?? null
      entry.agg.reviews ??= r.reviews ?? null
      entry.agg.category ??= r.category ?? null
    }
  }
  return [...byKey.values()]
    .map(({ agg, ranks, top3 }) => ({
      ...agg,
      appearances: ranks.length,
      avgRank: round2(sum(ranks) / ranks.length),
      solv: round2((top3 / total) * 100),
    }))
    .sort((a, b) => b.solv - a.solv || b.appearances - a.appearances || a.avgRank - b.avgRank)
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

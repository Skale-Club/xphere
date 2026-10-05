// Finds the tracked business in one point's results. Order of confidence:
// place_id, then Google's cid, then normalised name (backed by the street
// number when the names only partially match). The method used is stored on
// the point so a suspicious rank can be audited.

import type { MatchMethod, SerpResult, TargetIdentity, Top3Entry } from './types'

export type MatchResult = { rank: number | null; method: MatchMethod | null; index: number | null }

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Leading house number of an address ("123 Main St" -> "123"), if any. */
function streetNumber(address: string | null | undefined): string | null {
  const m = address?.match(/\b(\d{1,6})\b/)
  return m ? m[1] : null
}

function nameMatches(target: TargetIdentity, result: SerpResult): boolean {
  const a = normalizeName(target.name)
  const b = normalizeName(result.title)
  if (!a || !b) return false
  if (a === b) return true
  // Partial names ("Bigode" vs "Bigode Barbearia - Centro") only count when
  // the shorter one is distinctive and the street numbers agree.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length < 6 || !long.includes(short)) return false
  const ta = streetNumber(target.address)
  const tb = streetNumber(result.address)
  return ta !== null && ta === tb
}

export function findTarget(results: SerpResult[], target: TargetIdentity): MatchResult {
  const sorted = [...results].sort((x, y) => x.position - y.position)
  const pick = (pred: (r: SerpResult) => boolean, method: MatchMethod): MatchResult | null => {
    const i = sorted.findIndex(pred)
    return i === -1 ? null : { rank: sorted[i].position, method, index: results.indexOf(sorted[i]) }
  }
  if (target.placeId) {
    const hit = pick((r) => r.placeId === target.placeId, 'place_id')
    if (hit) return hit
  }
  if (target.cid) {
    const hit = pick((r) => !!r.cid && r.cid === target.cid, 'cid')
    if (hit) return hit
  }
  return pick((r) => nameMatches(target, r), 'name') ?? { rank: null, method: null, index: null }
}

export function top3(results: SerpResult[]): Top3Entry[] {
  return [...results]
    .sort((x, y) => x.position - y.position)
    .slice(0, 3)
    .map((r) => ({ position: r.position, title: r.title, placeId: r.placeId ?? null }))
}

/** Stable key for a business across points/scans: place_id or its normalised name. */
export function competitorKey(r: { placeId?: string | null; title: string }): string {
  return r.placeId ? `pid:${r.placeId}` : `name:${normalizeName(r.title)}`
}

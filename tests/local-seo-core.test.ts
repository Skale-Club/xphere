import { describe, expect, it } from 'vitest'

import { buildGrid, gridPointCount } from '@/lib/local-seo/grid'
import { competitorKey, findTarget, normalizeName, top3 } from '@/lib/local-seo/matching'
import { aggregateCompetitors, computeMetrics } from '@/lib/local-seo/metrics'
import { rankBand, type SerpResult } from '@/lib/local-seo/types'

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

describe('buildGrid', () => {
  const center = { centerLat: 40.7128, centerLng: -74.006 }

  it('lays out size x size points with the centre in the middle', () => {
    const g = buildGrid({ ...center, size: 7, spacingM: 1000, shape: 'square' })
    expect(g).toHaveLength(49)
    const mid = g.find((p) => p.row === 3 && p.col === 3)!
    expect(mid.lat).toBeCloseTo(40.7128, 5)
    expect(mid.lng).toBeCloseTo(-74.006, 5)
  })

  it('puts row 0 on the north edge and spaces neighbours by spacingM', () => {
    const g = buildGrid({ ...center, size: 5, spacingM: 1500, shape: 'square' })
    const at = (r: number, c: number) => g.find((p) => p.row === r && p.col === c)!
    expect(at(0, 2).lat).toBeGreaterThan(at(4, 2).lat)
    expect(at(2, 4).lng).toBeGreaterThan(at(2, 0).lng)
    expect(haversineM(at(2, 2), at(2, 3))).toBeGreaterThan(1450)
    expect(haversineM(at(2, 2), at(2, 3))).toBeLessThan(1550)
    expect(haversineM(at(2, 2), at(1, 2))).toBeGreaterThan(1450)
    expect(haversineM(at(2, 2), at(1, 2))).toBeLessThan(1550)
  })

  it('is symmetric around the centre', () => {
    const g = buildGrid({ ...center, size: 9, spacingM: 800, shape: 'square' })
    const at = (r: number, c: number) => g.find((p) => p.row === r && p.col === c)!
    expect(at(0, 0).lat - 40.7128).toBeCloseTo(40.7128 - at(8, 8).lat, 5)
    expect(at(0, 0).lng + 74.006).toBeCloseTo(-74.006 - at(8, 8).lng, 5)
  })

  it('crops corners for the circle shape', () => {
    const circle = buildGrid({ ...center, size: 7, spacingM: 1000, shape: 'circle' })
    expect(circle.length).toBeLessThan(49)
    expect(circle.find((p) => p.row === 0 && p.col === 0)).toBeUndefined()
    expect(circle.find((p) => p.row === 0 && p.col === 3)).toBeDefined()
    expect(gridPointCount(7, 'circle')).toBe(circle.length)
  })

  it('stays finite near the poles and wraps across the antimeridian', () => {
    const polar = buildGrid({ centerLat: 89.9, centerLng: 0, size: 3, spacingM: 1000, shape: 'square' })
    for (const p of polar) {
      expect(Number.isFinite(p.lng)).toBe(true)
      expect(p.lat).toBeLessThanOrEqual(90)
    }
    const dateline = buildGrid({ centerLat: 0, centerLng: 179.995, size: 3, spacingM: 2000, shape: 'square' })
    for (const p of dateline) {
      expect(p.lng).toBeGreaterThanOrEqual(-180)
      expect(p.lng).toBeLessThan(180)
    }
    expect(dateline.some((p) => p.lng < 0)).toBe(true)
  })

  it('rejects even or invalid sizes', () => {
    expect(() => buildGrid({ ...center, size: 4, spacingM: 1000, shape: 'square' })).toThrow()
    expect(() => buildGrid({ ...center, size: 5, spacingM: 0, shape: 'square' })).toThrow()
  })
})

describe('computeMetrics', () => {
  it('computes ARP over found points and ATRP with misses as 21', () => {
    const m = computeMetrics([1, 2, 5, null])
    expect(m.arp).toBe(2.67)
    expect(m.atrp).toBe(7.25) // (1+2+5+21)/4
    expect(m.solv).toBe(50)
    expect(m.foundPct).toBe(75)
  })

  it('handles a business that is never found', () => {
    const m = computeMetrics([null, null])
    expect(m.arp).toBeNull()
    expect(m.atrp).toBe(21)
    expect(m.solv).toBe(0)
    expect(m.foundPct).toBe(0)
  })

  it('returns nulls without points', () => {
    expect(computeMetrics([])).toEqual({ arp: null, atrp: null, solv: null, foundPct: null })
  })

  it('treats ranks beyond depth as misses', () => {
    expect(computeMetrics([25], 20)).toMatchObject({ arp: null, atrp: 21, foundPct: 0 })
  })
})

describe('aggregateCompetitors', () => {
  it('counts each business once per point and ranks by SoLV', () => {
    const p1: SerpResult[] = [
      { position: 1, title: 'Alpha', placeId: 'a' },
      { position: 2, title: 'Beta', placeId: 'b' },
      { position: 5, title: 'Alpha', placeId: 'a' }, // duplicate listing
    ]
    const p2: SerpResult[] = [
      { position: 1, title: 'Beta', placeId: 'b' },
      { position: 4, title: 'Alpha', placeId: 'a' },
    ]
    const out = aggregateCompetitors([p1, p2, []])
    const alpha = out.find((c) => c.key === 'pid:a')!
    const beta = out.find((c) => c.key === 'pid:b')!
    expect(alpha.appearances).toBe(2)
    expect(alpha.avgRank).toBe(2.5)
    expect(alpha.solv).toBe(33.33)
    expect(beta.solv).toBe(66.67)
    expect(out[0].key).toBe('pid:b')
  })
})

describe('matching', () => {
  const results: SerpResult[] = [
    { position: 1, title: 'Bigode Barbearia - Centro', placeId: 'other', address: '12 Rua A' },
    { position: 2, title: 'Corte Fino', placeId: 'p2', cid: '999' },
    { position: 3, title: 'Bigode', placeId: 'target', address: '45 Rua B' },
  ]

  it('prefers place_id', () => {
    expect(findTarget(results, { placeId: 'target', cid: null, name: 'Bigode' })).toMatchObject({ rank: 3, method: 'place_id', index: 2 })
  })

  it('falls back to cid', () => {
    expect(findTarget(results, { placeId: 'missing', cid: '999', name: 'x' })).toMatchObject({ rank: 2, method: 'cid' })
  })

  it('matches equal normalised names', () => {
    expect(findTarget(results, { placeId: null, cid: null, name: 'córte  FINO' })).toMatchObject({ rank: 2, method: 'name' })
  })

  it('only accepts partial names when the street number agrees', () => {
    expect(findTarget(results, { placeId: null, cid: null, name: 'Bigode Barbearia', address: '12 Rua A, Sao Paulo' })).toMatchObject({ rank: 1, method: 'name' })
    expect(findTarget(results, { placeId: null, cid: null, name: 'Bigode Barbearia', address: '99 Rua Z' }).rank).toBeNull()
  })

  it('reports a miss', () => {
    expect(findTarget(results, { placeId: 'nope', cid: null, name: 'Nobody Here' })).toEqual({ rank: null, method: null, index: null })
  })

  it('normalises names and builds keys', () => {
    expect(normalizeName('Café & Bar — São Paulo!')).toBe('cafe and bar sao paulo')
    expect(competitorKey({ placeId: 'x', title: 'A' })).toBe('pid:x')
    expect(competitorKey({ placeId: null, title: 'Café A' })).toBe('name:cafe a')
    expect(top3(results).map((t) => t.position)).toEqual([1, 2, 3])
  })

  it('bands ranks for pin colours', () => {
    expect([1, 3, 4, 10, 11, 20, null].map(rankBand)).toEqual(['top3', 'top3', 'mid', 'mid', 'low', 'low', 'none'])
  })
})

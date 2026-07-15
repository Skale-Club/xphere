import { describe, it, expect } from 'vitest'
import {
  isOrphanedAsset,
  partitionOrphanAssets,
  buildReferenceHaystack,
  type OrphanCandidate,
} from '@/lib/email/asset-references'

// Phase 5 — Consolidation & cleanup (email-builder-hardening PLAN.md).
// Covers the orphan-asset cleanup endpoint's reference-matching logic.

const NOW = new Date('2026-07-14T00:00:00.000Z')
const TEN_DAYS_AGO = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
const ONE_DAY_AGO = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()

describe('buildReferenceHaystack', () => {
  it('joins string parts as-is', () => {
    const hay = buildReferenceHaystack(['<img src="a.png">', '<p>hi</p>'])
    expect(hay).toContain('a.png')
    expect(hay).toContain('<p>hi</p>')
  })

  it('JSON-stringifies object/array parts so nested URLs are captured', () => {
    const doc = { sections: [{ columns: [[{ blockType: 'image', src: 'org1/asset.png' }]] }] }
    const hay = buildReferenceHaystack([doc])
    expect(hay).toContain('org1/asset.png')
  })

  it('skips null/undefined parts without throwing', () => {
    const hay = buildReferenceHaystack([null, undefined, 'kept.png'])
    expect(hay).toContain('kept.png')
  })
})

describe('isOrphanedAsset', () => {
  it('is not orphaned when the path appears in the haystack', () => {
    const candidate: OrphanCandidate = { path: 'org1/123-logo.png', createdAt: TEN_DAYS_AGO }
    const haystack = 'https://x.supabase.co/storage/v1/object/public/email-assets/org1/123-logo.png'
    expect(isOrphanedAsset(candidate, haystack, NOW)).toBe(false)
  })

  it('is orphaned when unreferenced and older than the grace period', () => {
    const candidate: OrphanCandidate = { path: 'org1/999-unused.png', createdAt: TEN_DAYS_AGO }
    expect(isOrphanedAsset(candidate, 'no references here', NOW)).toBe(true)
  })

  it('is NOT orphaned when unreferenced but within the grace period', () => {
    const candidate: OrphanCandidate = { path: 'org1/999-unused.png', createdAt: ONE_DAY_AGO }
    expect(isOrphanedAsset(candidate, 'no references here', NOW)).toBe(false)
  })

  it('is NOT orphaned when createdAt is missing (conservative default)', () => {
    const candidate: OrphanCandidate = { path: 'org1/999-unused.png', createdAt: null }
    expect(isOrphanedAsset(candidate, 'no references here', NOW)).toBe(false)
  })

  it('is NOT orphaned when createdAt is unparsable', () => {
    const candidate: OrphanCandidate = { path: 'org1/999-unused.png', createdAt: 'not-a-date' }
    expect(isOrphanedAsset(candidate, 'no references here', NOW)).toBe(false)
  })

  it('respects a custom minAgeDays', () => {
    const candidate: OrphanCandidate = { path: 'org1/999-unused.png', createdAt: ONE_DAY_AGO }
    expect(isOrphanedAsset(candidate, 'no references here', NOW, 0)).toBe(true)
    expect(isOrphanedAsset(candidate, 'no references here', NOW, 2)).toBe(false)
  })

  it('matches a path referenced inside html_snapshot text, not just document JSON', () => {
    const candidate: OrphanCandidate = { path: 'org1/1-banner.jpg', createdAt: TEN_DAYS_AGO }
    const htmlSnapshot = '<table><tr><td><img src="https://cdn/email-assets/org1/1-banner.jpg"></td></tr></table>'
    expect(isOrphanedAsset(candidate, htmlSnapshot, NOW)).toBe(false)
  })
})

describe('partitionOrphanAssets', () => {
  it('splits candidates into toDelete (orphaned+old) and toKeep (everything else)', () => {
    const candidates: OrphanCandidate[] = [
      { path: 'org1/referenced.png', createdAt: TEN_DAYS_AGO },
      { path: 'org1/orphan-old.png', createdAt: TEN_DAYS_AGO },
      { path: 'org1/orphan-recent.png', createdAt: ONE_DAY_AGO },
      { path: 'org1/unknown-age.png', createdAt: null },
    ]
    const haystack = 'org1/referenced.png'

    const { toDelete, toKeep } = partitionOrphanAssets(candidates, haystack, NOW)

    expect(toDelete.map((c) => c.path)).toEqual(['org1/orphan-old.png'])
    expect(toKeep.map((c) => c.path).sort()).toEqual(
      ['org1/referenced.png', 'org1/orphan-recent.png', 'org1/unknown-age.png'].sort(),
    )
  })

  it('returns empty toDelete when everything is referenced', () => {
    const candidates: OrphanCandidate[] = [
      { path: 'org1/a.png', createdAt: TEN_DAYS_AGO },
      { path: 'org1/b.png', createdAt: TEN_DAYS_AGO },
    ]
    const haystack = 'org1/a.png org1/b.png'
    const { toDelete, toKeep } = partitionOrphanAssets(candidates, haystack, NOW)
    expect(toDelete).toEqual([])
    expect(toKeep).toHaveLength(2)
  })

  it('handles an empty candidate list', () => {
    const { toDelete, toKeep } = partitionOrphanAssets([], '', NOW)
    expect(toDelete).toEqual([])
    expect(toKeep).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { suggestProperty } from '@/lib/seo/gsc/client'
import { grantedSearchConsole, GSC_SCOPE } from '@/lib/seo/gsc/oauth'
import { mapDailyRows, mapTopRows, syncRange, topSnapshotDue } from '@/lib/seo/gsc/sync'
import { dailySeries, pctChange, totals } from '@/lib/seo/gsc/metrics'
import { expectedCtr, lowCtr, pagesWithIssues, quickWins } from '@/lib/seo/gsc/opportunities'

describe('Search Console sync helpers', () => {
  it('backfills 16 months the first time, then re-syncs the last 5 days', () => {
    expect(syncRange('2026-10-05', false)).toEqual({ startDate: '2025-06-04', endDate: '2026-10-04' })
    expect(syncRange('2026-10-05', true)).toEqual({ startDate: '2026-09-30', endDate: '2026-10-04' })
  })

  it('maps daily rows and drops unknown devices', () => {
    const rows = mapDailyRows(
      [
        { keys: ['2026-10-01', 'MOBILE'], clicks: 3, impressions: 40.0, ctr: 0.075, position: 7.2 },
        { keys: ['2026-10-01', 'SMART_TV'], clicks: 1, impressions: 1, ctr: 1, position: 1 },
      ],
      'site',
      'org',
    )
    expect(rows).toEqual([
      { org_id: 'org', site_id: 'site', date: '2026-10-01', device: 'mobile', clicks: 3, impressions: 40, ctr: 0.075, position: 7.2 },
    ])
  })

  it('maps top rows with the window end', () => {
    expect(mapTopRows([{ keys: ['plumber boston'], clicks: 1, impressions: 2, ctr: 0.5, position: 3 }], 'query', 's', 'o', '2026-10-04')[0]).toMatchObject({
      dimension: 'query',
      key: 'plumber boston',
      window_end: '2026-10-04',
    })
  })

  it('snapshots top queries weekly', () => {
    expect(topSnapshotDue(null, '2026-10-04')).toBe(true)
    expect(topSnapshotDue('2026-09-30', '2026-10-04')).toBe(false)
    expect(topSnapshotDue('2026-09-27', '2026-10-04')).toBe(true)
  })
})

describe('OAuth helpers', () => {
  it('detects whether the Search Console scope was granted', () => {
    expect(grantedSearchConsole(`openid email ${GSC_SCOPE}`)).toBe(true)
    expect(grantedSearchConsole('openid email')).toBe(false)
    expect(grantedSearchConsole(undefined)).toBe(false)
  })

  it('suggests the matching property, domain property first', () => {
    const props = [
      { siteUrl: 'https://www.acme.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://other.com/', permissionLevel: 'siteOwner' },
    ]
    expect(suggestProperty(props, 'www.acme.com')).toBe('sc-domain:acme.com')
    expect(suggestProperty(props.slice(0, 1), 'acme.com')).toBe('https://www.acme.com/')
    expect(suggestProperty(props, 'nope.com')).toBeNull()
  })
})

describe('metrics', () => {
  const rows = [
    { date: '2026-10-01', device: 'mobile', clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
    { date: '2026-10-01', device: 'desktop', clicks: 0, impressions: 300, ctr: 0, position: 12 },
    { date: '2026-10-03', device: 'mobile', clicks: 5, impressions: 100, ctr: 0.05, position: 8 },
  ]

  it('weights position by impressions', () => {
    expect(totals(rows)).toEqual({ clicks: 15, impressions: 500, ctr: 0.03, position: (400 + 3600 + 800) / 500 })
    expect(totals([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: null })
  })

  it('fills gaps in the daily series', () => {
    const series = dailySeries(rows, '2026-10-01', '2026-10-03')
    expect(series.map((d) => [d.date, d.clicks])).toEqual([
      ['2026-10-01', 10],
      ['2026-10-02', 0],
      ['2026-10-03', 5],
    ])
  })

  it('computes period change', () => {
    expect(pctChange(150, 100)).toBe(0.5)
    expect(pctChange(5, 0)).toBeNull()
  })
})

describe('opportunities', () => {
  it('expected CTR falls with position', () => {
    expect(expectedCtr(1)).toBeGreaterThan(expectedCtr(3))
    expect(expectedCtr(15)).toBe(0.01)
    expect(expectedCtr(0.6)).toBe(expectedCtr(1))
  })

  it('finds quick wins on positions 4–20 with demand', () => {
    const wins = quickWins([
      { key: 'top', clicks: 100, impressions: 400, ctr: 0.25, position: 1.2 },
      { key: 'close', clicks: 10, impressions: 1000, ctr: 0.01, position: 6 },
      { key: 'tiny', clicks: 0, impressions: 10, ctr: 0, position: 8 },
      { key: 'far', clicks: 0, impressions: 900, ctr: 0, position: 45 },
    ])
    expect(wins.map((w) => w.key)).toEqual(['close'])
    expect(wins[0].potentialClicks).toBe(90)
  })

  it('flags low CTR for the position', () => {
    const rows = lowCtr([
      { key: 'bad', clicks: 5, impressions: 1000, ctr: 0.005, position: 2 },
      { key: 'fine', clicks: 150, impressions: 1000, ctr: 0.15, position: 2 },
      { key: 'deep', clicks: 0, impressions: 1000, ctr: 0, position: 15 },
    ])
    expect(rows.map((r) => r.key)).toEqual(['bad'])
    expect(rows[0].missedClicks).toBe(145)
  })

  it('cross-references pages with traffic and audit issues', () => {
    const audit = new Map([
      ['https://acme.com/a', { pageId: 'p1', errors: 1, warnings: 0 }],
      ['https://acme.com/b', { pageId: 'p2', errors: 0, warnings: 0 }],
    ])
    const out = pagesWithIssues(
      [
        { key: 'https://acme.com/a#frag', clicks: 20, impressions: 100, ctr: 0.2, position: 3 },
        { key: 'https://acme.com/b', clicks: 50, impressions: 100, ctr: 0.5, position: 1 },
        { key: 'https://acme.com/c', clicks: 0, impressions: 100, ctr: 0, position: 9 },
      ],
      audit,
    )
    expect(out.map((p) => [p.url, p.pageId])).toEqual([['https://acme.com/a', 'p1']])
  })
})

import { describe, expect, it } from 'vitest'
import { healthScore, summarizeIssues } from '@/lib/seo/score'

const pages = (n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${i}`)

describe('healthScore', () => {
  it('is 100 for a clean crawl', () => {
    expect(healthScore({ pageUrls: pages(10), issues: [] })).toBe(100)
  })

  it('is 0-ish when nothing could be crawled', () => {
    expect(healthScore({ pageUrls: [], issues: [{ code: 'crawl_blocked', url: null }] })).toBe(14)
  })

  it('normalises by crawl size: one bad page in 100 costs little', () => {
    const urls = pages(100)
    const one = healthScore({ pageUrls: urls, issues: [{ code: 'http_4xx', url: urls[0] }] })
    const all = healthScore({ pageUrls: urls, issues: urls.map((url) => ({ code: 'http_4xx', url })) })
    expect(one).toBe(100)
    expect(all).toBe(80)
  })

  it('weighs errors far more than notices and counts each code once per page', () => {
    const urls = pages(1)
    const error = healthScore({ pageUrls: urls, issues: [{ code: 'title_missing', url: urls[0] }] })
    const notice = healthScore({ pageUrls: urls, issues: [{ code: 'lang_missing', url: urls[0] }] })
    const repeated = healthScore({
      pageUrls: urls,
      issues: [
        { code: 'lang_missing', url: urls[0] },
        { code: 'lang_missing', url: urls[0] },
      ],
    })
    expect(error).toBe(80)
    expect(notice).toBe(98)
    expect(repeated).toBe(notice)
  })

  it('never goes below 0', () => {
    const urls = pages(1)
    const issues = ['http_5xx', 'title_missing', 'mixed_content', 'noindex_in_sitemap', 'broken_internal_link'].map((code) => ({ code, url: urls[0] }))
    const site = ['crawl_blocked', 'robots_blocks_all', 'no_https_redirect', 'sitemap_missing'].map((code) => ({ code, url: null }))
    expect(healthScore({ pageUrls: urls, issues: [...issues, ...site] })).toBe(0)
  })
})

describe('summarizeIssues', () => {
  it('counts by severity and code', () => {
    expect(
      summarizeIssues([
        { code: 'http_4xx', url: 'a' },
        { code: 'http_4xx', url: 'b' },
        { code: 'lang_missing', url: 'a' },
        { code: 'sitemap_missing', url: null },
      ]),
    ).toEqual({
      by_severity: { error: 2, warning: 1, notice: 1 },
      by_code: { http_4xx: 2, lang_missing: 1, sitemap_missing: 1 },
      total: 4,
    })
  })
})

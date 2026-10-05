// End-to-end test of the SEO audit engine against an in-memory stand-in for
// the Supabase client and a mocked web. Covers the whole lifecycle (setup →
// crawl → finalize), resuming across ticks, page caps and idempotent issues.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

// ── Mocked web ───────────────────────────────────────────────────────────────

type MockPage = { status: number; body?: string; location?: string; contentType?: string }
let web: Record<string, MockPage> = {}

vi.mock('@/lib/seo/fetch-page', () => ({
  fetchPage: vi.fn(async (url: string) => {
    const redirects: Array<{ url: string; status: number }> = []
    let current = url
    for (let i = 0; i < 6; i++) {
      const page = web[current]
      if (!page) return { ok: false, url, error: 'ENOTFOUND', blocked: false, redirects }
      if (page.location) {
        redirects.push({ url: current, status: page.status })
        current = new URL(page.location, current).toString()
        continue
      }
      return {
        ok: true,
        url,
        finalUrl: current,
        redirects,
        status: page.status,
        headers: {},
        contentType: page.contentType ?? 'text/html',
        body: page.body ?? '',
        bytes: (page.body ?? '').length,
        truncated: false,
        ttfbMs: 100,
      }
    }
    return { ok: false, url, error: 'too many redirects', blocked: false, redirects }
  }),
}))

vi.mock('@/lib/seo/pagespeed', () => ({
  runPageSpeed: vi.fn(async (url: string) => ({ url, performance: 90, lcpMs: 1500, cls: 0.01, inpMs: 100, fieldCategory: 'FAST' })),
}))

const emitted = vi.hoisted(() => [] as Array<{ type: string; payload: Record<string, unknown> }>)
vi.mock('@/lib/seo/events', () => ({
  emitSeoEvent: vi.fn(async (_sb: unknown, _org: string, type: string, payload: Record<string, unknown>) => {
    emitted.push({ type, payload })
    return { dispatched: 0, dispatchId: null }
  }),
}))

import { runSeoTick } from '@/lib/seo/audit-engine'
import { DEFAULTS, fakeSupabase, type Row } from './helpers/seo-fake-supabase'

// ── Fixture site ─────────────────────────────────────────────────────────────

const ROOT = 'https://acme.test/'
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
const doc = (path: string, title: string, links: string[], extra = '') =>
  `<html lang="en"><head><title>${title}</title><meta name="description" content="${'d'.repeat(100)} ${title}">` +
  `<meta name="viewport" content="width=device-width"><link rel="canonical" href="https://acme.test${path}">` +
  `<meta property="og:title" content="x"><script type="application/ld+json">{}</script></head>` +
  `<body><h1>${title}</h1>${links.map((l) => `<a href="${l}">${l}</a>`).join('')}<p>${words(400)} ${title}</p>${extra}</body></html>`

function buildWeb(extraPages: number) {
  const listing = Array.from({ length: extraPages }, (_, i) => `/p${i}`)
  web = {
    'https://acme.test/robots.txt': { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /private\nSitemap: https://acme.test/sitemap.xml' },
    'https://acme.test/sitemap.xml': {
      status: 200,
      contentType: 'application/xml',
      body: `<urlset><url><loc>https://acme.test/</loc></url><url><loc>https://acme.test/orphan</loc></url><url><loc>https://acme.test/old</loc></url></urlset>`,
    },
    'http://acme.test/': { status: 301, location: 'https://acme.test/' },
    'https://www.acme.test/': { status: 301, location: 'https://acme.test/' },
    [ROOT]: { status: 200, body: doc('/', 'Acme home page for testing things', ['/missing', '/old', '/private', '/dup-a', '/dup-b', ...listing]) },
    'https://acme.test/missing': { status: 404, body: 'nope' },
    'https://acme.test/old': { status: 302, location: '/new' },
    'https://acme.test/new': { status: 200, body: doc('/new', '/new page with a long enough title', []) },
    'https://acme.test/orphan': { status: 200, body: doc('/orphan', '/orphan page with a long enough title', []) },
    'https://acme.test/dup-a': { status: 200, body: doc('/dup-a', 'Duplicated title for two pages ok', []) },
    'https://acme.test/dup-b': { status: 200, body: doc('/dup-b', 'Duplicated title for two pages ok', []) },
  }
  for (const p of listing) web[`https://acme.test${p}`] = { status: 200, body: doc(p, `${p} listing page with a long title`, []) }
}

function seed(db: Record<string, Row[]>, maxPages = 200) {
  const org = randomUUID()
  const site = { id: randomUUID(), org_id: org, name: 'Acme', root_url: ROOT, host: 'acme.test', crawl_max_pages: maxPages, created_at: '2026-01-01' }
  db.seo_sites.push(site)
  const audit = { ...DEFAULTS.seo_audits, id: randomUUID(), org_id: org, site_id: site.id, max_pages: maxPages, created_at: '2026-01-01' }
  db.seo_audits.push(audit)
  return { site, audit }
}

const issuesOf = (db: Record<string, Row[]>, code: string) => db.seo_audit_issues.filter((i) => i.code === code).map((i) => i.url)

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SEO audit engine', () => {
  beforeEach(() => {
    buildWeb(4)
    emitted.length = 0
  })

  it('audits a site end to end in one tick', async () => {
    const { db, client } = fakeSupabase()
    const { audit } = seed(db)

    const result = await runSeoTick(client, 60_000)
    expect(result.claimed).toBe(1)

    const a = db.seo_audits.find((x) => x.id === audit.id)!
    expect(a.status).toBe('completed')
    expect(a.stage).toBe('done')
    expect(a.sitemap_urls).toBeNull()
    expect(a.lease_expires_at).toBeNull()
    expect(typeof a.health_score).toBe('number')

    const urls = db.seo_audit_pages.map((p) => p.url).sort()
    expect(urls).toContain('https://acme.test/new') // reached through the redirect
    expect(db.seo_audit_pages.find((p) => p.url === 'https://acme.test/private')?.status).toBe('skipped')

    expect(issuesOf(db, 'http_4xx')).toEqual(['https://acme.test/missing'])
    expect(issuesOf(db, 'redirect_temporary')).toEqual(['https://acme.test/old'])
    expect(issuesOf(db, 'broken_internal_link')).toEqual([ROOT])
    expect(issuesOf(db, 'links_to_redirect')).toEqual([ROOT])
    expect(issuesOf(db, 'orphan_page')).toEqual(['https://acme.test/orphan'])
    expect(issuesOf(db, 'sitemap_non_200')).toEqual(['https://acme.test/old'])
    expect(issuesOf(db, 'title_duplicate').sort()).toEqual(['https://acme.test/dup-a', 'https://acme.test/dup-b'])
    // Healthy site-level setup: no site issues.
    expect(db.seo_audit_issues.filter((i) => i.url === null)).toEqual([])

    const summary = a.summary as { by_code: Record<string, number>; total: number }
    expect(summary.total).toBe(db.seo_audit_issues.length)
    expect((a.site_checks as { cwv: unknown[] }).cwv.length).toBeGreaterThan(0)
    expect(db.seo_audit_pages.find((p) => p.url === 'https://acme.test/p0')?.inlinks).toBe(1)
  })

  it('resumes across ticks without duplicating issues', async () => {
    buildWeb(30)
    const { db, client } = fakeSupabase()
    const { audit } = seed(db)

    // A budget that only leaves ~0.5s of crawling: the audit must stop mid-crawl.
    await runSeoTick(client, 16_500)
    const mid = db.seo_audits.find((x) => x.id === audit.id)!
    expect(mid.status).toBe('running')
    expect(mid.lease_expires_at).toBeNull()
    const queued = db.seo_audit_pages.filter((p) => p.status === 'queued').length
    expect(queued).toBeGreaterThan(0)

    await runSeoTick(client, 60_000)
    const done = db.seo_audits.find((x) => x.id === audit.id)!
    expect(done.status).toBe('completed')
    expect(db.seo_audit_pages.filter((p) => p.status === 'queued')).toEqual([])

    const keys = db.seo_audit_issues.map((i) => `${i.code}|${i.url}`)
    expect(new Set(keys).size).toBe(keys.length)
  }, 30_000)

  it('respects the page cap', async () => {
    buildWeb(30)
    const { db, client } = fakeSupabase()
    const { audit } = seed(db, 10)
    await runSeoTick(client, 60_000)
    expect(db.seo_audits.find((x) => x.id === audit.id)!.status).toBe('completed')
    expect(db.seo_audit_pages.filter((p) => p.audit_id === audit.id).length).toBeLessThanOrEqual(10)
  })

  it('stops at a bot wall instead of crawling', async () => {
    web[ROOT] = { status: 403, body: '<html><title>Just a moment...</title></html>' }
    const { db, client } = fakeSupabase()
    const { audit } = seed(db)
    await runSeoTick(client, 60_000)
    const a = db.seo_audits.find((x) => x.id === audit.id)!
    expect(a.status).toBe('completed')
    expect(issuesOf(db, 'crawl_blocked')).toEqual([null])
    expect(db.seo_audit_pages.filter((p) => p.status !== 'queued')).toEqual([])
    expect(a.health_score).toBeLessThan(20)
  })

  it('emits audit_completed once, and critical_issue_new only for errors the previous audit lacked', async () => {
    const { db, client } = fakeSupabase()
    const { site } = seed(db)
    await runSeoTick(client, 60_000)
    expect(emitted.map((e) => e.type)).toEqual(['seo.audit_completed'])
    expect(emitted[0].payload).toMatchObject({ site_id: site.id, new_issue_count: 0, previous_health_score: null })

    // Second audit: a page that worked now returns 500 → one new error-severity issue.
    web['https://acme.test/p1'] = { status: 500, body: 'boom' }
    emitted.length = 0
    db.seo_audits.push({ ...DEFAULTS.seo_audits, id: randomUUID(), org_id: site.org_id, site_id: site.id, created_at: '2026-01-02' })
    await runSeoTick(client, 60_000)
    expect(emitted.map((e) => e.type)).toEqual(['seo.audit_completed', 'seo.critical_issue_new'])
    expect(emitted[1].payload.new_issues).toEqual([{ code: 'http_5xx', title: 'Page returns 5xx', url: 'https://acme.test/p1' }])
  })
})

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

import { runSeoTick } from '@/lib/seo/audit-engine'

// ── In-memory Supabase ───────────────────────────────────────────────────────

type Row = Record<string, unknown>
const DEFAULTS: Record<string, Row> = {
  seo_sites: { audit_schedule: 'off', next_audit_at: null, crawl_max_pages: 200 },
  seo_audits: {
    status: 'pending', stage: 'setup', trigger: 'manual', max_pages: 200, pages_discovered: 0, pages_crawled: 0,
    health_score: null, summary: null, site_checks: {}, sitemap_urls: null, attempts: 0, next_attempt_at: null,
    lease_expires_at: null, last_tick_at: null, error_message: null, started_at: null, finished_at: null,
  },
  seo_audit_pages: {
    depth: 0, status: 'queued', in_sitemap: false, http_status: null, redirect_to: null, redirect_hops: 0, links: null,
    title: null, meta_description: null, content_hash: null, canonical: null, indexable: null, content_type: null, outlinks: null,
  },
  seo_audit_issues: { source: 'page', page_id: null, url: null, details: null },
}

function fakeSupabase() {
  const db: Record<string, Row[]> = { seo_sites: [], seo_audits: [], seo_audit_pages: [], seo_audit_issues: [] }
  let clock = 0
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + clock++).toISOString()
  const make = (table: string, r: Row): Row => ({ id: randomUUID(), created_at: stamp(), ...DEFAULTS[table], ...r })

  function builder(table: string) {
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row[] = []
    let patch: Row = {}
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
    let returning = false
    const filters: Array<(r: Row) => boolean> = []
    const orders: Array<[string, boolean]> = []
    let limitN: number | null = null
    let rangeAB: [number, number] | null = null
    let single: 'one' | 'maybe' | null = null

    const run = () => {
      const rows = db[table]
      const match = (r: Row) => filters.every((f) => f(r))
      let result: Row[] = []
      if (op === 'insert') {
        result = payload.map((p) => make(table, p))
        rows.push(...result)
      } else if (op === 'upsert') {
        const keys = (upsertOpts.onConflict ?? 'id').split(',')
        for (const p of payload) {
          const existing = rows.find((r) => keys.every((k) => r[k] === p[k]))
          if (existing) {
            if (!upsertOpts.ignoreDuplicates) Object.assign(existing, p)
          } else {
            const created = make(table, p)
            rows.push(created)
            result.push(created)
          }
        }
      } else if (op === 'update') {
        result = rows.filter(match)
        result.forEach((r) => Object.assign(r, patch))
      } else if (op === 'delete') {
        db[table] = rows.filter((r) => !match(r))
      } else {
        result = rows.filter(match)
        for (const [col, asc] of [...orders].reverse()) {
          result = [...result].sort((a, b) => {
            const x = a[col] as never, y = b[col] as never
            return (x === y ? 0 : x < y ? -1 : 1) * (asc ? 1 : -1)
          })
        }
        if (rangeAB) result = result.slice(rangeAB[0], rangeAB[1] + 1)
        if (limitN !== null) result = result.slice(0, limitN)
      }
      const data = op === 'select' || returning ? result.map((r) => ({ ...r })) : null
      if (single) {
        if (single === 'one' && data?.length !== 1) return { data: null, error: { message: 'not single' } }
        return { data: data?.[0] ?? null, error: null }
      }
      return { data, error: null }
    }

    const q = {
      select: () => { if (op !== 'select') returning = true; return q },
      insert: (rows: Row | Row[]) => { op = 'insert'; payload = [rows].flat(); return q },
      upsert: (rows: Row | Row[], opts = {}) => { op = 'upsert'; payload = [rows].flat(); upsertOpts = opts; return q },
      update: (p: Row) => { op = 'update'; patch = p; return q },
      delete: () => { op = 'delete'; return q },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
      not: (c: string) => { filters.push((r) => r[c] !== null && r[c] !== undefined); return q },
      order: (c: string, o?: { ascending?: boolean }) => { orders.push([c, o?.ascending ?? true]); return q },
      limit: (n: number) => { limitN = n; return q },
      range: (a: number, b: number) => { rangeAB = [a, b]; return q },
      maybeSingle: () => { single = 'maybe'; return q },
      single: () => { single = 'one'; return q },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    }
    return q
  }

  const rpc = async (name: string, args: Record<string, number>) => {
    if (name === 'claim_seo_audits') {
      const now = Date.now()
      const claimable = db.seo_audits
        .filter((a) => ['pending', 'running'].includes(a.status as string))
        .filter((a) => !a.lease_expires_at || new Date(a.lease_expires_at as string).getTime() < now)
        .filter((a) => !a.next_attempt_at || new Date(a.next_attempt_at as string).getTime() <= now)
        .slice(0, args.p_limit)
      for (const a of claimable) {
        Object.assign(a, {
          status: 'running',
          started_at: a.started_at ?? new Date().toISOString(),
          lease_expires_at: new Date(now + args.p_lease_seconds * 1000).toISOString(),
          last_tick_at: new Date().toISOString(),
        })
      }
      return { data: claimable.map((a) => ({ ...a })), error: null }
    }
    return { data: 0, error: null }
  }

  return { db, client: { from: builder, rpc } as never }
}

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
  beforeEach(() => buildWeb(4))

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
})

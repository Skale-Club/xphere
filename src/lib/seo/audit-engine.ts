// SEO audit engine: advances audits in short, resumable slices.
//
// Called by /api/cron/seo-tick every minute with a time budget. Each tick:
//   1. enqueues scheduled audits that are due,
//   2. leases a few runnable audits (claim_seo_audits),
//   3. moves each one forward — setup → crawl → finalize — until the budget
//      runs out, persisting progress as it goes,
//   4. prunes page/issue detail of old audits (retention).
//
// Nothing lives only in memory between ticks: the frontier is
// seo_audit_pages.status = 'queued', so a deploy that kills a tick mid-crawl
// costs at most the pages in flight. Every write is idempotent on retry
// (issues for a page are replaced, final issues are replaced wholesale).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { fetchPage, type FetchPageResult } from './fetch-page'
import { extractPage, type ExtractedPage } from './extract'
import { parseRobots, type Robots } from './robots'
import { parseSitemap } from './sitemap'
import { isSameSite, looksLikePage, normalizeUrl } from './url'
import { checkPage } from './checks/page'
import { checkCrossPage, type CrawledPage } from './checks/cross-page'
import { checkSite, emptySiteChecks, type CoreWebVitals, type SiteChecks } from './checks/site'
import { issueDefinition, type IssueFinding } from './checks/catalog'
import { runPageSpeed } from './pagespeed'
import { healthScore, summarizeIssues } from './score'
import { selectAll } from './select-all'
import { runGscSyncs, type GscSyncResult } from './gsc/sync'

type Sb = SupabaseClient<Database>
type AuditRow = Database['public']['Tables']['seo_audits']['Row']
type SiteRow = Database['public']['Tables']['seo_sites']['Row']
type PageUpdate = Database['public']['Tables']['seo_audit_pages']['Update']

/** Audits advanced in parallel per tick. */
export const AUDITS_PER_TICK = 3
/** Concurrent page fetches per audit. */
export const FETCH_CONCURRENCY = 4
/** Lease must outlive one tick (budget + slowest fetch) so ticks never overlap on an audit. */
export const LEASE_SECONDS = 150
/** A crawl still going after this long is finalised with what it has. */
const MAX_CRAWL_MS = 3 * 60 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_SITEMAP_FILES = 10
const MAX_SITEMAP_URLS = 10_000
const PSI_PAGES = 5
const MIN_FINALIZE_BUDGET_MS = 45_000
const ROBOTS_MAX_CHARS = 64_000
const POLITE_DELAY_MS = 250
const INSERT_CHUNK = 500

// ───────────────────────────────────────────────────────────────────────────
// Tick
// ───────────────────────────────────────────────────────────────────────────

export interface TickResult {
  enqueued: number
  claimed: number
  audits: Array<{ id: string; stage: string; status: string; crawled?: number; error?: string }>
  pruned: number
  gsc: GscSyncResult
}

export async function runSeoTick(sb: Sb, budgetMs: number): Promise<TickResult> {
  const deadline = Date.now() + budgetMs

  // Search Console first: a few small API calls per site, so it never waits
  // behind a long crawl. Failures are recorded per site and never stop audits.
  let gsc: GscSyncResult = { claimed: 0, synced: [], failed: [] }
  try {
    gsc = await runGscSyncs(sb)
  } catch (err) {
    console.error('[seo-tick] gsc sync failed:', err instanceof Error ? err.message : err)
  }

  const { data: enqueued, error: enqueueError } = await sb.rpc('enqueue_due_seo_audits')
  if (enqueueError) console.error('[seo-tick] enqueue failed:', enqueueError.message)

  const { data: claimed, error: claimError } = await sb.rpc('claim_seo_audits', {
    p_limit: AUDITS_PER_TICK,
    p_lease_seconds: LEASE_SECONDS,
  })
  if (claimError) throw new Error(`claim_seo_audits failed: ${claimError.message}`)
  const audits = (claimed ?? []) as AuditRow[]

  const results = await Promise.all(
    audits.map(async (audit) => {
      try {
        const outcome = await advanceAudit(sb, audit, deadline)
        return { id: audit.id, ...outcome }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[seo-tick] audit ${audit.id} failed this tick:`, message)
        await recordFailure(sb, audit, message)
        return { id: audit.id, stage: audit.stage, status: 'retrying', error: message }
      }
    }),
  )

  let pruned = 0
  const { data: prunedCount, error: pruneError } = await sb.rpc('prune_seo_audit_details', {})
  if (pruneError) console.error('[seo-tick] prune failed:', pruneError.message)
  else pruned = prunedCount ?? 0

  return { enqueued: enqueued ?? 0, claimed: audits.length, audits: results, pruned, gsc }
}

async function recordFailure(sb: Sb, audit: AuditRow, message: string) {
  const attempts = audit.attempts + 1
  const dead = attempts >= MAX_ATTEMPTS
  const backoffMinutes = [1, 5, 15, 60][Math.min(attempts - 1, 3)]
  await sb
    .from('seo_audits')
    .update({
      attempts,
      error_message: message.slice(0, 1000),
      lease_expires_at: null,
      next_attempt_at: dead ? null : new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
      ...(dead ? { status: 'failed' as const, stage: 'done' as const, finished_at: new Date().toISOString(), sitemap_urls: null } : {}),
    })
    .eq('id', audit.id)
    .in('status', ['pending', 'running'])
}

async function advanceAudit(
  sb: Sb,
  audit: AuditRow,
  deadline: number,
): Promise<{ stage: string; status: string; crawled?: number }> {
  const { data: site } = await sb.from('seo_sites').select('*').eq('id', audit.site_id).maybeSingle()
  if (!site) {
    await sb
      .from('seo_audits')
      .update({ status: 'failed', stage: 'done', error_message: 'Site was deleted', finished_at: new Date().toISOString(), lease_expires_at: null })
      .eq('id', audit.id)
    return { stage: 'done', status: 'failed' }
  }

  let stage = audit.stage
  let current = audit

  if (stage === 'setup') {
    current = await runSetup(sb, current, site)
    stage = current.stage
  }

  let crawled: number | undefined
  if (stage === 'crawl') {
    const crawlAge = Date.now() - new Date(current.started_at ?? current.created_at).getTime()
    if (crawlAge > MAX_CRAWL_MS) {
      stage = 'finalize'
    } else {
      const result = await runCrawl(sb, current, site, deadline)
      crawled = result.crawled
      if (result.frontierEmpty) stage = 'finalize'
    }
    if (stage === 'finalize') await sb.from('seo_audits').update({ stage: 'finalize' }).eq('id', current.id)
  }

  if (stage === 'finalize' && deadline - Date.now() >= MIN_FINALIZE_BUDGET_MS) {
    await runFinalize(sb, { ...current, stage: 'finalize' }, site, deadline)
    return { stage: 'done', status: 'completed', crawled }
  }

  // Release the lease so the next tick can pick it straight back up.
  await sb.from('seo_audits').update({ lease_expires_at: null, error_message: null }).eq('id', current.id)
  return { stage, status: 'running', crawled }
}

// ───────────────────────────────────────────────────────────────────────────
// Setup: robots.txt, sitemaps, https / host probes, seed the frontier
// ───────────────────────────────────────────────────────────────────────────

/** Bot-protection responses: refuse to crawl rather than hammer a WAF. */
export function detectBlocked(res: FetchPageResult): { status: number | null; reason: string } | null {
  if (!res.ok) return null
  const challenge =
    res.headers['cf-mitigated'] === 'challenge' ||
    /just a moment|attention required|cf-chl|captcha|access denied/i.test((res.body ?? '').slice(0, 5000))
  if ((res.status === 403 || res.status === 429 || res.status === 503) && challenge) {
    return { status: res.status, reason: 'Bot protection / challenge page' }
  }
  if (res.status === 403 || res.status === 429) return { status: res.status, reason: `HTTP ${res.status} on the home page` }
  return null
}

function twinUrl(rootUrl: string): string {
  const u = new URL(rootUrl)
  u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`
  return u.toString()
}

async function runSetup(sb: Sb, audit: AuditRow, site: SiteRow): Promise<AuditRow> {
  const root = new URL(site.root_url)
  const homeUrl = normalizeUrl(site.root_url) ?? site.root_url
  const checks: SiteChecks & { robotsTxt?: string } = emptySiteChecks()

  const httpUrl = `http://${root.host}/`
  const [home, robotsRes, httpRes, twinRes] = await Promise.all([
    fetchPage(homeUrl),
    fetchPage(new URL('/robots.txt', root).toString(), { maxBytes: 512 * 1024 }),
    root.protocol === 'https:' ? fetchPage(httpUrl, { timeoutMs: 10_000 }) : Promise.resolve(null),
    fetchPage(twinUrl(site.root_url), { timeoutMs: 10_000 }),
  ])

  checks.crawlBlocked = detectBlocked(home)
  if (httpRes) checks.httpProbe = httpRes.ok ? { finalUrl: httpRes.finalUrl, status: httpRes.status } : { finalUrl: null, status: null }
  checks.twinProbe = twinRes.ok ? { url: twinUrl(site.root_url), finalUrl: twinRes.finalUrl, status: twinRes.status } : null

  let robots: Robots | null = null
  if (robotsRes.ok) {
    const isText = robotsRes.status === 200 && !/html/.test(robotsRes.contentType)
    const text = isText ? (robotsRes.body ?? '').slice(0, ROBOTS_MAX_CHARS) : ''
    robots = parseRobots(text, robotsRes.finalUrl)
    checks.robots = { status: robotsRes.status, blocksAll: isText && robots.blocksAll(), sitemaps: robots.sitemaps }
    checks.robotsTxt = text
  }

  // Sitemaps: robots.txt declarations, else the conventional location.
  const sources = robots?.sitemaps.length ? robots.sitemaps : [new URL('/sitemap.xml', root).toString()]
  const sitemap = await collectSitemapUrls(sources, site.host)
  checks.sitemap = { found: sitemap.found, valid: sitemap.valid, urls: sitemap.urls.length, sources: sitemap.fetched }

  const sitemapUrls = sitemap.urls.slice(0, MAX_SITEMAP_URLS)
  const seedLimit = Math.max(1, Math.floor(audit.max_pages / 2))
  const seeds: Array<{ url: string; depth: number; in_sitemap: boolean }> = [
    { url: homeUrl, depth: 0, in_sitemap: sitemapUrls.includes(homeUrl) },
  ]
  if (!checks.crawlBlocked) {
    for (const url of sitemapUrls) {
      if (seeds.length >= seedLimit) break
      if (url !== homeUrl && looksLikePage(url)) seeds.push({ url, depth: 1, in_sitemap: true })
    }
  }

  await insertChunked(
    sb,
    'seo_audit_pages',
    seeds.map((s) => ({ ...s, org_id: audit.org_id, audit_id: audit.id })),
    { onConflict: 'audit_id,url', ignoreDuplicates: true },
  )

  const { data: updated, error } = await sb
    .from('seo_audits')
    .update({
      // A blocked crawl has nothing to fetch; go straight to the report.
      stage: checks.crawlBlocked ? 'finalize' : 'crawl',
      site_checks: checks as unknown as Json,
      sitemap_urls: sitemapUrls,
      pages_discovered: seeds.length,
    })
    .eq('id', audit.id)
    .select('*')
    .single()
  if (error || !updated) throw new Error(`setup update failed: ${error?.message}`)
  return updated
}

async function collectSitemapUrls(sources: string[], host: string) {
  const queue = [...new Set(sources)]
  const seen = new Set<string>()
  const urls = new Set<string>()
  const fetched: string[] = []
  let found = false
  let valid = false

  while (queue.length && seen.size < MAX_SITEMAP_FILES && urls.size < MAX_SITEMAP_URLS) {
    const batch = queue.splice(0, 4).filter((u) => !seen.has(u))
    batch.forEach((u) => seen.add(u))
    const responses = await Promise.all(
      batch.map((u) => fetchPage(u, { gunzip: true, maxBytes: 10 * 1024 * 1024, timeoutMs: 20_000 })),
    )
    responses.forEach((res, i) => {
      if (!res.ok || res.status !== 200 || !res.body) return
      found = true
      fetched.push(batch[i])
      const parsed = parseSitemap(res.body)
      if (parsed.kind === 'invalid') return
      valid = true
      if (parsed.kind === 'index') {
        for (const child of parsed.sitemaps) if (isSameSite(child, host) && !seen.has(child)) queue.push(child)
        return
      }
      for (const raw of parsed.urls) {
        const url = normalizeUrl(raw)
        if (url && isSameSite(url, host)) urls.add(url)
        if (urls.size >= MAX_SITEMAP_URLS) break
      }
    })
  }
  return { found, valid, urls: [...urls], fetched }
}

// ───────────────────────────────────────────────────────────────────────────
// Crawl: drain the frontier until the budget runs out
// ───────────────────────────────────────────────────────────────────────────

interface FrontierRow {
  id: string
  url: string
  depth: number
  in_sitemap: boolean
}

async function runCrawl(
  sb: Sb,
  audit: AuditRow,
  site: SiteRow,
  deadline: number,
): Promise<{ crawled: number; frontierEmpty: boolean }> {
  const checks = (audit.site_checks ?? {}) as { robotsTxt?: string }
  const robots = checks.robotsTxt ? parseRobots(checks.robotsTxt) : null
  const sitemapSet = new Set(audit.sitemap_urls ?? [])
  let discovered = audit.pages_discovered
  let crawledTotal = audit.pages_crawled
  let crawledThisTick = 0

  // Leave room for the slowest fetch (15s) to finish inside the budget.
  while (Date.now() < deadline - 16_000) {
    const { data: batch, error } = await sb
      .from('seo_audit_pages')
      .select('id, url, depth, in_sitemap')
      .eq('audit_id', audit.id)
      .eq('status', 'queued')
      .order('depth', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(FETCH_CONCURRENCY)
    if (error) throw new Error(`frontier read failed: ${error.message}`)
    if (!batch?.length) return { crawled: crawledThisTick, frontierEmpty: true }

    const processed = await Promise.all(batch.map((row) => crawlOne(row as FrontierRow, site, robots)))

    const newLinks = new Map<string, number>()
    for (const [i, result] of processed.entries()) {
      const row = batch[i] as FrontierRow
      await sb.from('seo_audit_issues').delete().eq('page_id', row.id)
      if (result.issues.length) {
        const { error: issueError } = await sb.from('seo_audit_issues').insert(
          result.issues.map((f) => ({
            org_id: audit.org_id,
            audit_id: audit.id,
            page_id: row.id,
            url: row.url,
            code: f.code,
            severity: issueDefinition(f.code)?.severity ?? 'notice',
            source: 'page' as const,
            details: (f.details ?? null) as Json,
          })),
        )
        if (issueError) throw new Error(`issue insert failed: ${issueError.message}`)
      }
      const { error: pageError } = await sb.from('seo_audit_pages').update(result.update).eq('id', row.id)
      if (pageError) throw new Error(`page update failed: ${pageError.message}`)
      for (const link of result.links) if (!newLinks.has(link)) newLinks.set(link, row.depth + 1)
    }

    crawledThisTick += batch.length
    crawledTotal += batch.length

    const capacity = audit.max_pages - discovered
    if (capacity > 0 && newLinks.size) {
      const rows = [...newLinks.entries()].map(([url, depth]) => ({
        org_id: audit.org_id,
        audit_id: audit.id,
        url,
        depth: Math.min(depth, 100),
        in_sitemap: sitemapSet.has(url),
      }))
      // Links already in the frontier are ignored, so offer a few more than
      // capacity and trim any overshoot; the rows actually inserted are what
      // advance `discovered`. The +100 bounds the trim's id list.
      const { data: inserted, error: linkError } = await sb
        .from('seo_audit_pages')
        .upsert(rows.slice(0, capacity + 100), { onConflict: 'audit_id,url', ignoreDuplicates: true })
        .select('id')
      if (linkError) throw new Error(`frontier insert failed: ${linkError.message}`)
      let added = inserted?.length ?? 0
      if (added > capacity) {
        // Overshot: drop the newest extras so the crawl respects max_pages.
        const extra = (inserted ?? []).slice(capacity).map((r) => r.id)
        await sb.from('seo_audit_pages').delete().in('id', extra)
        added = capacity
      }
      discovered += added
    }

    await sb
      .from('seo_audits')
      .update({ pages_discovered: discovered, pages_crawled: crawledTotal, last_tick_at: new Date().toISOString() })
      .eq('id', audit.id)

    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS))
  }
  return { crawled: crawledThisTick, frontierEmpty: false }
}

interface CrawlOutcome {
  update: PageUpdate
  issues: IssueFinding[]
  /** Same-site page links to add to the frontier. */
  links: string[]
}

async function crawlOne(row: FrontierRow, site: SiteRow, robots: Robots | null): Promise<CrawlOutcome> {
  const now = new Date().toISOString()
  const path = (() => {
    const u = new URL(row.url)
    return u.pathname + u.search
  })()
  if (robots && !robots.isAllowed(path)) {
    return { update: { status: 'skipped', error: 'Blocked by robots.txt', fetched_at: now }, issues: [], links: [] }
  }

  const res = await fetchPage(row.url)
  if (!res.ok) {
    const issues = checkPage({ url: row.url, error: res.error, httpStatus: null, redirectStatuses: [], ttfbMs: null, isHtml: false, extracted: null })
    return {
      update: { status: 'failed', error: res.error.slice(0, 500), redirect_hops: res.redirects.length, fetched_at: now },
      issues,
      links: [],
    }
  }

  const redirectStatuses = res.redirects.map((r) => r.status)
  const finalUrl = normalizeUrl(res.finalUrl) ?? res.finalUrl
  const redirected = redirectStatuses.length > 0 && finalUrl !== row.url

  if (redirected) {
    const internal = isSameSite(finalUrl, site.host) && looksLikePage(finalUrl)
    return {
      update: {
        status: 'fetched',
        http_status: redirectStatuses[0],
        redirect_to: finalUrl,
        redirect_hops: redirectStatuses.length,
        ttfb_ms: res.ttfbMs,
        content_type: res.contentType || null,
        fetched_at: now,
      },
      issues: checkPage({ url: row.url, error: null, httpStatus: redirectStatuses[0], redirectStatuses, ttfbMs: res.ttfbMs, isHtml: false, extracted: null }),
      links: internal ? [finalUrl] : [],
    }
  }

  const isHtml = /html/.test(res.contentType) || (!res.contentType && /^\s*</.test(res.body ?? ''))
  let extracted: ExtractedPage | null = null
  if (isHtml && res.status === 200 && res.body) extracted = extractPage(res.body, row.url, res.headers)

  const issues = checkPage({ url: row.url, error: null, httpStatus: res.status, redirectStatuses: [], ttfbMs: res.ttfbMs, isHtml, extracted })
  return {
    update: {
      status: 'fetched',
      http_status: res.status,
      redirect_to: null,
      redirect_hops: 0,
      ttfb_ms: res.ttfbMs,
      content_type: res.contentType || null,
      bytes: res.bytes,
      title: extracted?.title?.slice(0, 500) ?? null,
      meta_description: extracted?.metaDescription?.slice(0, 1000) ?? null,
      h1: extracted?.h1?.slice(0, 500) ?? null,
      h1_count: extracted?.h1Count ?? null,
      word_count: extracted?.wordCount ?? null,
      canonical: extracted?.canonical ?? null,
      indexable: res.status === 200 && isHtml && !(extracted?.noindex ?? false),
      content_hash: extracted?.contentHash ?? null,
      links: extracted?.internalLinks ?? [],
      outlinks: extracted ? extracted.internalLinks.length + extracted.externalLinkCount : null,
      error: null,
      fetched_at: now,
    },
    issues,
    links: extracted?.internalLinks ?? [],
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Finalize: cross-page + site checks, Core Web Vitals, score
// ───────────────────────────────────────────────────────────────────────────

type PageRowForFinalize = Pick<
  Database['public']['Tables']['seo_audit_pages']['Row'],
  | 'id' | 'url' | 'status' | 'http_status' | 'redirect_to' | 'content_type' | 'title' | 'meta_description'
  | 'content_hash' | 'canonical' | 'indexable' | 'in_sitemap' | 'links' | 'outlinks' | 'depth'
>

async function runFinalize(sb: Sb, audit: AuditRow, site: SiteRow, deadline: number) {
  const pages = await selectAll<PageRowForFinalize>((from, to) =>
    sb
      .from('seo_audit_pages')
      .select('id, url, status, http_status, redirect_to, content_type, title, meta_description, content_hash, canonical, indexable, in_sitemap, links, outlinks, depth')
      .eq('audit_id', audit.id)
      .in('status', ['fetched', 'failed'])
      .order('created_at', { ascending: true })
      .range(from, to),
  )

  const crawled: CrawledPage[] = pages.map((p) => ({
    url: p.url,
    httpStatus: p.status === 'failed' ? null : p.http_status,
    redirectTo: p.redirect_to,
    isHtml: /html/.test(p.content_type ?? ''),
    title: p.title,
    metaDescription: p.meta_description,
    contentHash: p.content_hash,
    canonical: p.canonical,
    indexable: p.indexable ?? false,
    inSitemap: p.in_sitemap,
    links: p.links ?? [],
  }))

  const rootUrl = normalizeUrl(site.root_url) ?? site.root_url
  const homeRow = crawled.find((p) => p.url === rootUrl)
  const homeUrl = homeRow?.redirectTo ?? rootUrl
  const cross = checkCrossPage(crawled, homeUrl)

  // Core Web Vitals: home + the most-linked live pages, in parallel.
  const checks = { ...emptySiteChecks(), ...((audit.site_checks ?? {}) as Partial<SiteChecks>) } as SiteChecks & { robotsTxt?: string }
  if (!checks.crawlBlocked) {
    const candidates = crawled
      .filter((p) => p.httpStatus === 200 && !p.redirectTo && p.isHtml && p.indexable)
      .sort((a, b) => (a.url === homeUrl ? -1 : b.url === homeUrl ? 1 : (cross.inlinks.get(b.url) ?? 0) - (cross.inlinks.get(a.url) ?? 0)))
      .slice(0, PSI_PAGES)
      .map((p) => p.url)
    const timeout = Math.max(10_000, Math.min(40_000, deadline - Date.now() - 8_000))
    checks.cwv = candidates.length ? await Promise.all(candidates.map((u) => runPageSpeed(u, timeout))) : []
  }

  const findings = [...cross.findings, ...checkSite(checks, site.root_url)]
  const pageIdByUrl = new Map(pages.map((p) => [p.url, p.id]))

  // Replace the final pass wholesale so a re-run finalisation never duplicates.
  const { error: delError } = await sb.from('seo_audit_issues').delete().eq('audit_id', audit.id).eq('source', 'final')
  if (delError) throw new Error(`final issue cleanup failed: ${delError.message}`)
  await insertChunked(
    sb,
    'seo_audit_issues',
    findings.map((f) => ({
      org_id: audit.org_id,
      audit_id: audit.id,
      page_id: f.url ? (pageIdByUrl.get(f.url) ?? null) : null,
      url: f.url,
      code: f.code,
      severity: issueDefinition(f.code)?.severity ?? 'notice',
      source: 'final' as const,
      details: (f.details ?? null) as Json,
    })),
  )

  // Inlink counts for the Pages table.
  await insertChunked(
    sb,
    'seo_audit_pages',
    pages.map((p) => ({ id: p.id, org_id: audit.org_id, audit_id: audit.id, url: p.url, inlinks: cross.inlinks.get(p.url) ?? 0 })),
    { onConflict: 'id' },
  )

  const allIssues = await selectAll<{ code: string; url: string | null }>((from, to) =>
    sb.from('seo_audit_issues').select('code, url').eq('audit_id', audit.id).order('id').range(from, to),
  )
  const score = healthScore({ pageUrls: pages.map((p) => p.url), issues: allIssues })

  const { robotsTxt: _robotsTxt, ...storedChecks } = checks
  void _robotsTxt
  const { error } = await sb
    .from('seo_audits')
    .update({
      status: 'completed',
      stage: 'done',
      health_score: score,
      summary: summarizeIssues(allIssues) as unknown as Json,
      site_checks: storedChecks as unknown as Json,
      sitemap_urls: null,
      pages_crawled: pages.length,
      finished_at: new Date().toISOString(),
      lease_expires_at: null,
      error_message: null,
    })
    .eq('id', audit.id)
    // A member may have cancelled while this tick ran; don't resurrect it.
    .eq('status', 'running')
  if (error) throw new Error(`audit completion failed: ${error.message}`)
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

async function insertChunked(
  sb: Sb,
  table: 'seo_audit_pages' | 'seo_audit_issues',
  rows: Record<string, unknown>[],
  upsert?: { onConflict: string; ignoreDuplicates?: boolean },
) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK) as never[]
    const { error } = upsert ? await sb.from(table).upsert(chunk, upsert) : await sb.from(table).insert(chunk)
    if (error) throw new Error(`${table} write failed: ${error.message}`)
  }
}

export type { CoreWebVitals }

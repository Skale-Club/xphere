// Cross-page checks: need the whole crawl (duplicates, link graph, sitemap
// membership). Run once when the frontier is empty.

import type { IssueFinding } from './catalog'

/** The subset of a seo_audit_pages row the cross-page checks read. */
export interface CrawledPage {
  url: string
  /** Fetch outcome: null when the request itself failed. */
  httpStatus: number | null
  redirectTo: string | null
  isHtml: boolean
  title: string | null
  metaDescription: string | null
  contentHash: string | null
  canonical: string | null
  /** False when noindex. */
  indexable: boolean
  inSitemap: boolean
  /** Normalised internal links found on the page. */
  links: string[]
}

const MAX_SOURCES_IN_DETAILS = 10

export interface CrossPageResult {
  findings: IssueFinding[]
  /** Inbound internal link count per crawled URL. */
  inlinks: Map<string, number>
}

export function checkCrossPage(pages: CrawledPage[], homeUrl: string): CrossPageResult {
  const findings: IssueFinding[] = []
  const byUrl = new Map(pages.map((p) => [p.url, p]))

  // ── Link graph ──────────────────────────────────────────────────────────
  const inlinks = new Map<string, number>(pages.map((p) => [p.url, 0]))
  const brokenLinks = new Map<string, Array<{ target: string; status: number | null }>>()
  const redirectLinks = new Map<string, Array<{ target: string; redirect_to: string }>>()

  for (const page of pages) {
    for (const target of new Set(page.links)) {
      if (target === page.url) continue
      if (inlinks.has(target)) inlinks.set(target, (inlinks.get(target) ?? 0) + 1)
      const t = byUrl.get(target)
      if (!t) continue
      if (t.httpStatus === null || t.httpStatus >= 400) {
        push(brokenLinks, page.url, { target, status: t.httpStatus })
      } else if (t.redirectTo) {
        push(redirectLinks, page.url, { target, redirect_to: t.redirectTo })
      }
    }
  }
  for (const [url, targets] of brokenLinks) {
    findings.push({ code: 'broken_internal_link', url, details: { count: targets.length, links: targets.slice(0, MAX_SOURCES_IN_DETAILS) } })
  }
  for (const [url, targets] of redirectLinks) {
    findings.push({ code: 'links_to_redirect', url, details: { count: targets.length, links: targets.slice(0, MAX_SOURCES_IN_DETAILS) } })
  }

  // ── Indexable, live HTML pages: the set duplicate checks compare ────────
  const rankable = pages.filter(
    (p) =>
      p.httpStatus === 200 &&
      !p.redirectTo &&
      p.isHtml &&
      p.indexable &&
      // A page canonicalised elsewhere already declares itself a copy.
      (!p.canonical || p.canonical === p.url),
  )

  duplicateGroups(rankable, (p) => p.title?.toLowerCase() ?? null).forEach((group) => {
    for (const p of group) findings.push({ code: 'title_duplicate', url: p.url, details: { title: p.title, others: others(group, p) } })
  })

  const exactTitleDupes = new Set(
    [...duplicateGroups(rankable, (p) => p.title?.toLowerCase() ?? null).values()].flat().map((p) => p.url),
  )
  duplicateGroups(
    rankable.filter((p) => !exactTitleDupes.has(p.url)),
    (p) => titleStem(p.title),
  ).forEach((group) => {
    for (const p of group) findings.push({ code: 'title_cannibalization', url: p.url, details: { title: p.title, others: others(group, p) } })
  })

  duplicateGroups(rankable, (p) => p.metaDescription?.toLowerCase() ?? null).forEach((group) => {
    for (const p of group) findings.push({ code: 'meta_description_duplicate', url: p.url, details: { others: others(group, p) } })
  })

  duplicateGroups(rankable, (p) => p.contentHash).forEach((group) => {
    for (const p of group) findings.push({ code: 'duplicate_content', url: p.url, details: { others: others(group, p) } })
  })

  // ── Canonical targets that are not live ─────────────────────────────────
  for (const p of pages) {
    if (!p.canonical || p.canonical === p.url) continue
    const target = byUrl.get(p.canonical)
    if (target && (target.httpStatus === null || target.httpStatus >= 300 || target.redirectTo)) {
      findings.push({ code: 'canonical_to_broken', url: p.url, details: { canonical: p.canonical, status: target.httpStatus } })
    }
  }

  // ── Sitemap hygiene and orphans ─────────────────────────────────────────
  for (const p of pages) {
    if (!p.inSitemap) continue
    if (p.httpStatus === null || p.httpStatus !== 200 || p.redirectTo) {
      findings.push({ code: 'sitemap_non_200', url: p.url, details: { status: p.httpStatus, redirect_to: p.redirectTo } })
      continue
    }
    if (p.isHtml && !p.indexable) findings.push({ code: 'noindex_in_sitemap', url: p.url })
    if (p.url !== homeUrl && (inlinks.get(p.url) ?? 0) === 0) findings.push({ code: 'orphan_page', url: p.url })
  }

  return { findings, inlinks }
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function duplicateGroups(pages: CrawledPage[], key: (p: CrawledPage) => string | null): CrawledPage[][] {
  const groups = new Map<string, CrawledPage[]>()
  for (const p of pages) {
    const k = key(p)
    if (k) push(groups, k, p)
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

function others(group: CrawledPage[], self: CrawledPage): string[] {
  return group.filter((p) => p !== self).slice(0, MAX_SOURCES_IN_DETAILS).map((p) => p.url)
}

/**
 * Title with a trailing "| Brand" / "- Brand" / "– Brand" suffix removed and
 * case folded, so "Plumbing | Acme" and "Plumbing – Acme Co" collide.
 */
export function titleStem(title: string | null): string | null {
  if (!title) return null
  const stem = title.split(/\s+[|\-–—·]\s+/)[0].trim().toLowerCase()
  return stem.length >= 10 ? stem : null
}

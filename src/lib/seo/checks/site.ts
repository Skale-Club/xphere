// Site-level checks: robots.txt, sitemap, https and host consistency, Core
// Web Vitals. Inputs are the probe results stored in seo_audits.site_checks.

import type { IssueFinding } from './catalog'

export interface SiteChecks {
  robots: { status: number | null; blocksAll: boolean; sitemaps: string[] } | null
  sitemap: { found: boolean; valid: boolean; urls: number; sources: string[] } | null
  /** Where http://<host>/ ends up; null when the probe failed. */
  httpProbe: { finalUrl: string | null; status: number | null } | null
  /** Where the www/apex twin of the host ends up; null when it does not resolve. */
  twinProbe: { url: string; finalUrl: string | null; status: number | null } | null
  /** Root fetch was refused by bot protection (403/429/503 or a challenge page). */
  crawlBlocked: { status: number | null; reason: string } | null
  cwv: CoreWebVitals[] | null
}

export interface CoreWebVitals {
  url: string
  /** 0–100 Lighthouse performance score (mobile). */
  performance: number | null
  lcpMs: number | null
  cls: number | null
  inpMs: number | null
  /** Field-data category when CrUX has it: FAST | AVERAGE | SLOW. */
  fieldCategory: string | null
  error?: string
}

export function emptySiteChecks(): SiteChecks {
  return { robots: null, sitemap: null, httpProbe: null, twinProbe: null, crawlBlocked: null, cwv: null }
}

/** LCP > 4s, CLS > 0.25 or INP > 500ms is "poor" per web.dev thresholds. */
export function isPoorCwv(v: CoreWebVitals): boolean {
  if (v.fieldCategory === 'SLOW') return true
  return (v.lcpMs ?? 0) > 4000 || (v.cls ?? 0) > 0.25 || (v.inpMs ?? 0) > 500 || (v.performance ?? 100) < 50
}

export function checkSite(site: SiteChecks, rootUrl: string): IssueFinding[] {
  const out: IssueFinding[] = []
  const add = (code: IssueFinding['code'], details?: Record<string, unknown>) =>
    out.push({ code, url: null, ...(details ? { details } : {}) })

  if (site.crawlBlocked) add('crawl_blocked', { status: site.crawlBlocked.status, reason: site.crawlBlocked.reason })

  if (site.robots) {
    if (site.robots.status === 404 || site.robots.status === 410) add('robots_missing')
    else if (site.robots.blocksAll) add('robots_blocks_all')
  }

  if (site.sitemap) {
    if (!site.sitemap.found) add('sitemap_missing')
    else if (!site.sitemap.valid) add('sitemap_invalid', { sources: site.sitemap.sources })
  }

  const root = new URL(rootUrl)
  if (root.protocol === 'https:' && site.httpProbe?.status) {
    const final = site.httpProbe.finalUrl
    if (!final || !final.startsWith('https://')) add('no_https_redirect', { final_url: final })
  }

  if (site.twinProbe?.finalUrl && site.twinProbe.status && site.twinProbe.status < 400) {
    const twinHost = new URL(site.twinProbe.finalUrl).hostname
    // The twin should land on the audited host; landing on itself means two live copies.
    if (twinHost !== root.hostname) add('www_inconsistent', { twin: site.twinProbe.url, lands_on: site.twinProbe.finalUrl })
  }

  const poor = (site.cwv ?? []).filter((v) => !v.error && isPoorCwv(v))
  if (poor.length) add('cwv_poor', { pages: poor.map((v) => ({ url: v.url, performance: v.performance, lcp_ms: v.lcpMs, cls: v.cls })) })

  return out
}

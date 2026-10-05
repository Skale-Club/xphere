// Search Console opportunities — what to work on next. Pure functions over the
// weekly top-query/top-page snapshot (seo_gsc_top) and the latest audit.

import { normalizeUrl } from '../url'

export interface TopRow {
  key: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/**
 * Typical organic CTR by rounded position (desktop+mobile blend of public
 * click-curve studies). Only used to spot outliers, so precision is not the
 * point — a page at 30% of the expected CTR is underperforming either way.
 */
const CTR_CURVE = [0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018]

export function expectedCtr(position: number): number {
  const p = Math.max(1, Math.round(position))
  if (p < CTR_CURVE.length) return CTR_CURVE[p]
  return p <= 20 ? 0.01 : 0.003
}

export const QUICK_WIN_MIN_IMPRESSIONS = 50
export const LOW_CTR_MIN_IMPRESSIONS = 100

export interface QuickWin extends TopRow {
  /** Extra monthly clicks if this query reached position 3. */
  potentialClicks: number
}

/**
 * "Almost there": queries ranking 4–20 with real demand. Moving them into the
 * top 3 is usually cheaper than ranking for something new.
 */
export function quickWins(queries: TopRow[], limit = 20): QuickWin[] {
  return queries
    .filter((q) => q.position >= 3.5 && q.position <= 20.5 && q.impressions >= QUICK_WIN_MIN_IMPRESSIONS)
    .map((q) => ({ ...q, potentialClicks: Math.max(0, Math.round(q.impressions * expectedCtr(3) - q.clicks)) }))
    .sort((a, b) => b.potentialClicks - a.potentialClicks || b.impressions - a.impressions)
    .slice(0, limit)
}

export interface LowCtr extends TopRow {
  expectedCtr: number
  /** Clicks lost versus the expected CTR for this position. */
  missedClicks: number
}

/**
 * Ranking well but not getting clicked: CTR under half of what the position
 * usually earns. Fix by rewriting the title/meta description.
 */
export function lowCtr(rows: TopRow[], limit = 20): LowCtr[] {
  return rows
    .filter((r) => r.position <= 10.5 && r.impressions >= LOW_CTR_MIN_IMPRESSIONS)
    .map((r) => {
      const exp = expectedCtr(r.position)
      return { ...r, expectedCtr: exp, missedClicks: Math.round(r.impressions * (exp - r.ctr)) }
    })
    .filter((r) => r.ctr < r.expectedCtr / 2 && r.missedClicks > 0)
    .sort((a, b) => b.missedClicks - a.missedClicks)
    .slice(0, limit)
}

export interface PageWithIssues extends TopRow {
  url: string
  errors: number
  warnings: number
  pageId: string
}

/**
 * Cross-reference with the audit: pages that already earn search traffic AND
 * have errors/warnings. Fixing these protects clicks you already get, so they
 * go first.
 */
export function pagesWithIssues(
  pages: TopRow[],
  auditPages: Map<string, { pageId: string; errors: number; warnings: number }>,
  limit = 20,
): PageWithIssues[] {
  const out: PageWithIssues[] = []
  for (const p of pages) {
    if (p.clicks <= 0) continue
    const url = normalizeUrl(p.key) ?? p.key
    const audit = auditPages.get(url)
    if (!audit || audit.errors + audit.warnings === 0) continue
    out.push({ ...p, url, ...audit })
  }
  return out.sort((a, b) => b.errors - a.errors || b.clicks - a.clicks).slice(0, limit)
}

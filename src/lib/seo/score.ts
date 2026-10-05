// Health score (0–100) for an audit.
//
//   page score  = 100 − Σ penalty of each distinct issue code on that page
//                 (error 25 · warning 8 · notice 2), floored at 0
//   site score  = 100 − Σ penalty of each site-level issue
//                 (error 30 · warning 10 · notice 3), floored at 0
//   health      = round(0.8 × mean(page scores) + 0.2 × site score)
//
// Averaging per-page scores normalises by crawl size: one broken page out of
// 200 costs little, the same issue on every page costs a lot. Errors weigh ~12×
// a notice so the score tracks what actually hurts rankings. When no page
// could be crawled (site down or blocked) the page term is 0.

import { issueDefinition, type IssueSeverity } from './checks/catalog'

const PAGE_PENALTY: Record<IssueSeverity, number> = { error: 25, warning: 8, notice: 2 }
const SITE_PENALTY: Record<IssueSeverity, number> = { error: 30, warning: 10, notice: 3 }

export interface ScoreInput {
  /** URLs of pages that were crawled (fetched or failed), excluding redirect hops. */
  pageUrls: string[]
  issues: Array<{ code: string; url: string | null }>
}

export function healthScore({ pageUrls, issues }: ScoreInput): number {
  const perPage = new Map<string, Set<string>>(pageUrls.map((u) => [u, new Set()]))
  const siteCodes = new Set<string>()
  for (const issue of issues) {
    if (issue.url === null) siteCodes.add(issue.code)
    else perPage.get(issue.url)?.add(issue.code)
  }

  const penalty = (codes: Set<string>, table: Record<IssueSeverity, number>) =>
    [...codes].reduce((sum, code) => sum + (table[issueDefinition(code)?.severity ?? 'notice'] ?? 0), 0)

  const pageScores = [...perPage.values()].map((codes) => Math.max(0, 100 - penalty(codes, PAGE_PENALTY)))
  const pageTerm = pageScores.length ? pageScores.reduce((a, b) => a + b, 0) / pageScores.length : 0
  const siteTerm = Math.max(0, 100 - penalty(siteCodes, SITE_PENALTY))

  return Math.max(0, Math.min(100, Math.round(0.8 * pageTerm + 0.2 * siteTerm)))
}

/** Count issues by severity and by code — stored in seo_audits.summary. */
export function summarizeIssues(issues: Array<{ code: string; url: string | null }>) {
  const bySeverity: Record<IssueSeverity, number> = { error: 0, warning: 0, notice: 0 }
  const byCode: Record<string, number> = {}
  for (const issue of issues) {
    const sev = issueDefinition(issue.code)?.severity ?? 'notice'
    bySeverity[sev]++
    byCode[issue.code] = (byCode[issue.code] ?? 0) + 1
  }
  return { by_severity: bySeverity, by_code: byCode, total: issues.length }
}

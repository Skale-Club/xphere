// Human-readable lines for an issue's `details` JSON, per code. Pure, so the
// sheets stay dumb and the wording is testable.

type Details = Record<string, unknown> | null | undefined

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function describeIssueDetails(code: string, details: Details): string[] {
  if (!details) return []
  switch (code) {
    case 'broken_internal_link':
      return list(details.links).map((l) => {
        const link = l as { target?: string; status?: number | null }
        return `${str(link.target)} (${link.status ? `HTTP ${link.status}` : 'failed'})`
      })
    case 'links_to_redirect':
      return list(details.links).map((l) => {
        const link = l as { target?: string; redirect_to?: string }
        return `${str(link.target)} → ${str(link.redirect_to)}`
      })
    case 'title_duplicate':
    case 'title_cannibalization':
    case 'meta_description_duplicate':
    case 'duplicate_content': {
      const others = list(details.others).map(str)
      const head = details.title ? [`“${str(details.title)}”`] : []
      return [...head, ...others.map((o) => `Also on ${o}`)]
    }
    case 'title_length':
      return [`${str(details.length)} characters: “${str(details.title)}”`]
    case 'meta_description_length':
      return [`${str(details.length)} characters`]
    case 'h1_multiple':
      return [`${str(details.count)} H1 tags`]
    case 'canonical_elsewhere':
    case 'canonical_to_broken':
      return [`Canonical: ${str(details.canonical)}${details.status ? ` (HTTP ${str(details.status)})` : ''}`]
    case 'images_missing_alt':
      return [`${str(details.count)} of ${str(details.total)} images`]
    case 'thin_content':
      return [`${str(details.words)} words`]
    case 'slow_ttfb':
      return [`${str(details.ttfb_ms)} ms to first byte`]
    case 'mixed_content':
      return list(details.resources).map(str)
    case 'redirect_chain':
      return [`${str(details.hops)} hops`]
    case 'redirect_temporary':
      return [`Status codes: ${list(details.statuses).map(str).join(' → ')}`]
    case 'http_4xx':
    case 'http_5xx':
      return [`HTTP ${str(details.status)}`]
    case 'fetch_failed':
      return [str(details.error)]
    case 'sitemap_non_200':
      return [details.redirect_to ? `Redirects to ${str(details.redirect_to)}` : `HTTP ${str(details.status) || 'failed'}`]
    case 'crawl_blocked':
      return [`${str(details.reason)}${details.status ? ` (HTTP ${str(details.status)})` : ''}`]
    case 'no_https_redirect':
      return [`http:// ends at ${str(details.final_url) || 'an error'}`]
    case 'www_inconsistent':
      return [`${str(details.twin)} serves the site without redirecting`]
    case 'sitemap_invalid':
      return list(details.sources).map(str)
    case 'cwv_poor':
      return list(details.pages).map((p) => {
        const v = p as { url?: string; performance?: number | null; lcp_ms?: number | null; cls?: number | null }
        const parts = [
          v.performance != null ? `performance ${v.performance}` : null,
          v.lcp_ms != null ? `LCP ${(v.lcp_ms / 1000).toFixed(1)}s` : null,
          v.cls != null ? `CLS ${v.cls.toFixed(2)}` : null,
        ].filter(Boolean)
        return `${str(v.url)} — ${parts.join(', ')}`
      })
    default:
      return []
  }
}

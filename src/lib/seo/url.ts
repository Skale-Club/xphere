// URL handling for the SEO crawler: normalisation (so the same page is one
// frontier row), same-site scoping and "is this worth fetching as a page".

/** Query params that never change page content — stripped so tracked links collapse into one URL. */
const TRACKING_PARAMS = /^(utm_[a-z_]+|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|igshid|ref_src)$/i

/** Extensions that are never HTML pages. Links to these are not queued. */
const NON_PAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'rtf',
  'zip', 'rar', 'gz', 'tgz', '7z', 'dmg', 'exe', 'apk',
  'mp3', 'mp4', 'm4a', 'mov', 'avi', 'webm', 'wav', 'ogg',
  'css', 'js', 'mjs', 'json', 'xml', 'woff', 'woff2', 'ttf', 'otf', 'eot',
])

/**
 * Canonical string form of a crawlable URL, or null when it is not http(s).
 * Lowercases scheme/host, drops the fragment, default ports and tracking
 * params, sorts the remaining params, and collapses an empty path to "/".
 * The trailing slash on non-root paths is kept: /a and /a/ can be different
 * pages, and flagging that is the canonical check's job, not the normaliser's.
 */
export function normalizeUrl(raw: string, base?: string | URL): string | null {
  let url: URL
  try {
    url = base ? new URL(raw.trim(), base) : new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null

  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = ''
  }

  const kept = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k))
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  url.search = kept.length ? new URLSearchParams(kept).toString() : ''

  if (!url.pathname) url.pathname = '/'
  return url.toString()
}

/** Host without a leading "www." — www and apex count as the same site. */
export function siteKey(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/** True when `url` belongs to the audited site (same host, ignoring www). */
export function isSameSite(url: string | URL, host: string): boolean {
  try {
    const u = typeof url === 'string' ? new URL(url) : url
    return siteKey(u.hostname) === siteKey(host)
  } catch {
    return false
  }
}

/** False for links whose path ends in a known non-HTML extension. */
export function looksLikePage(url: string): boolean {
  try {
    const path = new URL(url).pathname
    const last = path.split('/').pop() ?? ''
    const dot = last.lastIndexOf('.')
    if (dot <= 0) return true
    return !NON_PAGE_EXTENSIONS.has(last.slice(dot + 1).toLowerCase())
  } catch {
    return false
  }
}

/**
 * Parse what a user typed into "Add site" into a root URL. Accepts bare
 * domains ("example.com") and full URLs; always returns the origin + "/".
 */
export function parseSiteInput(input: string): { rootUrl: string; host: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  // Require a dotted public-looking hostname; IP literals and single labels
  // ("localhost", "intranet") are not sites anyone audits for SEO.
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) return null
  return { rootUrl: `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}/`, host }
}

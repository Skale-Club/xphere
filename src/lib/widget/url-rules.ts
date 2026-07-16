// src/lib/widget/url-rules.ts
// Pure, dependency-free URL authorization rules for the embeddable chat widget.
//
// This module is imported by BOTH the browser widget bundle (src/widget/index.ts,
// bundled by esbuild into public/widget.js) and the Node API routes
// (src/app/api/widget/[token]/config, src/app/api/chat/[token]). It MUST stay
// free of any imports so it bundles cleanly into the browser IIFE and adds no
// weight beyond the small functions actually used.
//
// A "rule" is a plain pattern string entered by an org admin:
//   example.com            → that exact host, any path
//   *.example.com          → that host and any subdomain, any path
//   example.com/checkout   → that host, exact path /checkout
//   example.com/app/*      → that host, any path starting with /app/
//   */pricing              → any host, path /pricing
//   *                      → everything
//
// `mode` decides how a match is interpreted:
//   'all'       → widget runs everywhere (rules ignored) — default, back-compat
//   'allowlist' → widget runs ONLY where a rule matches
//   'blocklist' → widget runs everywhere EXCEPT where a rule matches

export type WidgetUrlMode = 'all' | 'allowlist' | 'blocklist'

export const WIDGET_URL_MODES: readonly WidgetUrlMode[] = ['all', 'allowlist', 'blocklist']

/** Max number of rules stored/evaluated for one org (guards against abuse). */
export const WIDGET_URL_RULES_MAX = 50

/** Coerce an arbitrary value into a valid mode, defaulting to 'all'. */
export function normalizeWidgetUrlMode(value: unknown): WidgetUrlMode {
  return value === 'allowlist' || value === 'blocklist' ? value : 'all'
}

/**
 * Normalize a raw rules value into a clean, de-duplicated string[].
 * Accepts a DB jsonb array, or a newline/comma-separated textarea string.
 */
export function normalizeWidgetUrlRules(value: unknown, max: number = WIDGET_URL_RULES_MAX): string[] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : []

  const out: string[] = []
  for (const raw of parts) {
    if (typeof raw !== 'string') continue
    const pattern = raw.trim().toLowerCase()
    if (!pattern || pattern.length > 255) continue
    if (!out.includes(pattern)) out.push(pattern)
    if (out.length >= max) break
  }
  return out
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp('^' + escaped + '$')
}

/** Does a single pattern match the given hostname + pathname? */
export function matchesRule(rawPattern: string, hostname: string, pathname: string): boolean {
  let pattern = String(rawPattern || '').trim().toLowerCase()
  if (!pattern) return false
  // Drop an accidental scheme and any query/hash the admin may have pasted.
  pattern = pattern.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[?#].*$/, '')
  if (!pattern) return false

  const slash = pattern.indexOf('/')
  const hostPat = slash === -1 ? pattern : pattern.slice(0, slash)
  // No path in the pattern → match any path on that host.
  const pathPat = slash === -1 ? '/*' : pattern.slice(slash)

  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '')
  const path = String(pathname || '/').toLowerCase() || '/'

  // Host match
  let hostOk: boolean
  if (hostPat === '' || hostPat === '*') {
    hostOk = true
  } else if (hostPat.startsWith('*.')) {
    const base = hostPat.slice(2)
    hostOk = host === base || host.endsWith('.' + base)
  } else {
    hostOk = host === hostPat
  }
  if (!hostOk) return false

  // Path match — '/*' matches any path.
  return globToRegExp(pathPat).test(path)
}

export interface WidgetLocation {
  hostname: string
  pathname: string
}

/** Core decision: should the widget run at this location? */
export function isWidgetAllowed(
  mode: WidgetUrlMode,
  rules: string[],
  location: WidgetLocation,
): boolean {
  if (mode === 'all') return true
  const matched = rules.some((rule) => matchesRule(rule, location.hostname, location.pathname))
  return mode === 'allowlist' ? matched : !matched
}

/**
 * Derive a trusted visitor location from request headers.
 *
 * The `Origin` header is added by the browser on cross-origin requests and
 * CANNOT be forged by page JavaScript, so it is the trustworthy source of the
 * host. `Referer` is used as a fallback (and cross-origin it is usually
 * origin-only due to the default `strict-origin-when-cross-origin` policy).
 *
 * Because browsers strip the path from cross-origin Referer, the widget also
 * sends its full page URL (`clientUrl`). We trust that URL's PATH only after
 * confirming its host equals the browser-provided host — so a forged clientUrl
 * cannot pretend to be on a different, authorized domain.
 */
export function resolveRequestLocation(
  origin: string | null,
  referer: string | null,
  clientUrl: string | null,
): WidgetLocation | null {
  let trusted: WidgetLocation | null = null

  if (origin && origin !== 'null') {
    try {
      const u = new URL(origin)
      trusted = { hostname: u.hostname, pathname: '/' }
    } catch { /* ignore */ }
  }
  if (!trusted && referer) {
    try {
      const u = new URL(referer)
      trusted = { hostname: u.hostname, pathname: u.pathname }
    } catch { /* ignore */ }
  }
  if (!trusted) return null

  // Enrich the path from the client-supplied full URL, but only if its host
  // matches the trusted (unspoofable) host.
  if (clientUrl) {
    try {
      const u = new URL(clientUrl)
      if (u.hostname.toLowerCase() === trusted.hostname.toLowerCase()) {
        return { hostname: trusted.hostname, pathname: u.pathname }
      }
    } catch { /* ignore */ }
  }
  return trusted
}

/**
 * Server-side enforcement: given an org's config and the incoming request's
 * headers, decide whether to serve the widget.
 *
 * Fails CLOSED for allowlist (block when the location can't be determined) and
 * OPEN for blocklist, matching each mode's intent.
 */
export function isRequestAllowed(
  mode: WidgetUrlMode,
  rules: string[],
  headers: { origin: string | null; referer: string | null; clientUrl: string | null },
): boolean {
  if (mode === 'all') return true
  const location = resolveRequestLocation(headers.origin, headers.referer, headers.clientUrl)
  if (!location) return mode !== 'allowlist'
  return isWidgetAllowed(mode, rules, location)
}

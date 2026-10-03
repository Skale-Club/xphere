/**
 * Per-tab active organization, carried by the URL.
 *
 * A dashboard URL may be prefixed with `/o/<org-uuid>` (e.g.
 * `/o/7c1e…/contacts`). The proxy strips the prefix, rewrites to the real route
 * and forwards the org in the `x-xphere-org` request header; the server
 * Supabase client passes that header on to PostgREST, where
 * `get_current_org_id()` honours it — but only when the caller is a member of
 * that org (migration 1308). The header is therefore a *selector*, never an
 * authorization: forging it can only pick one of your own orgs.
 *
 * Without any org signal the DB default (`user_active_org`) applies, exactly as
 * before — so every tab can show a different org and a refresh keeps the org the
 * tab is showing instead of whichever org was switched to last.
 *
 * Edge-safe: imported by the proxy, server code and the browser.
 */

export const ORG_HEADER = 'x-xphere-org'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PREFIX_RE = /^\/o\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/i

export function isOrgId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** `/o/<id>/contacts` → `{ orgId, rest: '/contacts' }`; `/o/<id>` → rest `''`. */
export function splitOrgPath(pathname: string): { orgId: string; rest: string } | null {
  const match = PREFIX_RE.exec(pathname)
  if (!match) return null
  return { orgId: match[1].toLowerCase(), rest: pathname.slice(match[0].length) }
}

/** The route path without the org prefix (`/o/<id>/contacts` → `/contacts`). */
export function stripOrgPrefix(pathname: string): string {
  const split = splitOrgPath(pathname)
  if (!split) return pathname
  return split.rest || '/'
}

/** Org-pinned URL for `path` (which may carry a query/hash or an old prefix). */
export function orgPath(orgId: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const pathEnd = normalized.search(/[?#]/)
  const pathname = pathEnd === -1 ? normalized : normalized.slice(0, pathEnd)
  const suffix = pathEnd === -1 ? '' : normalized.slice(pathEnd)
  const stripped = stripOrgPrefix(pathname)
  return `/o/${orgId.toLowerCase()}${stripped === '/' ? '' : stripped}${suffix}`
}

/**
 * Org pinned by a same-origin Referer. Covers requests made from an org-pinned
 * page that cannot carry the header themselves (hard navigations, a link
 * opened in a new tab, EventSource).
 */
export function orgFromReferer(referer: string | null | undefined, host: string | null | undefined): string | null {
  if (!referer) return null
  try {
    const url = new URL(referer)
    if (host && url.host !== host) return null
    return splitOrgPath(url.pathname)?.orgId ?? null
  } catch {
    return null
  }
}

/**
 * The org a request asks for, strongest signal first: explicit header (set by
 * the proxy from the URL prefix, or by the tab's fetch wrapper), then Referer.
 * Null → the DB default applies.
 *
 * Deliberately no cookie fallback: cookies are shared by every tab, which is
 * the very thing this module exists to avoid. Server-side redirects keep the
 * prefix explicitly instead (src/lib/org/redirect.ts).
 */
export function resolveRequestOrgId(input: {
  header?: string | null
  referer?: string | null
  host?: string | null
}): string | null {
  if (isOrgId(input.header)) return input.header.toLowerCase()
  return orgFromReferer(input.referer, input.host)
}

/**
 * Shared bits of the `/api/poll/*` GET route handlers.
 *
 * High-frequency polls (under ~10s) go through route handlers instead of
 * server actions: Next serializes server actions per client, so a 3s action
 * poll queues every user click behind it. Route handlers run in parallel, still
 * use `createClient()` (member session, RLS, the tab's `x-xphere-org` header
 * that `installTabOrgFetch` adds to same-origin fetches) and are never cached.
 */

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export function pollJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function pollUnauthorized(): Response {
  return pollJson({ error: 'Unauthorized' }, 401)
}

export function pollBadRequest(message: string): Response {
  return pollJson({ error: message }, 400)
}

/** A parseable timestamp made only of characters an ISO string uses. */
export function isSafeTimestamp(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 40 &&
    /^[0-9T:.+\-Z ]+$/.test(value) &&
    Number.isFinite(new Date(value).getTime())
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

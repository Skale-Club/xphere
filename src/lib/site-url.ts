/**
 * Canonical public origin resolution.
 *
 * Background: the production app runs as a Next.js standalone build inside a
 * Docker container on Coolify/Hetzner. The container binds to `0.0.0.0:3000`,
 * so `new URL(request.url).origin` inside a Route Handler can resolve to the
 * internal container address (`http://0.0.0.0:3000`) rather than the public
 * domain. If an OAuth callback redirects to that internal origin the browser
 * ends up at `https://0.0.0.0:3000/` → ERR_ADDRESS_INVALID.
 *
 * Always build first-party redirect/callback URLs from the canonical origin
 * instead of the request socket. `NEXT_PUBLIC_SITE_URL` is the source of truth
 * (inlined at build time, see Dockerfile build args); we fall back to the
 * reverse-proxy forwarded host, then finally the request origin.
 *
 * Usage guide:
 *   - Server components / server actions → getSiteOriginFromHeaders()  [async, uses next/headers]
 *   - Route Handlers with a Request arg   → resolveRequestOrigin(request)
 *   - Client components / shared utils   → getSiteOrigin()
 */

const CANONICAL_FALLBACK = 'https://xphere.app'

/** Strip a single trailing slash so callers can append paths cleanly. */
function normalize(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Client/server-safe origin for building `redirectTo` URLs.
 * Prefers the configured site URL; falls back to the current browser origin.
 * In server contexts without a configured URL falls back to the canonical
 * production domain — use getSiteOriginFromHeaders() in server components
 * when localhost dev-accuracy matters.
 */
export function getSiteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return normalize(configured)
  if (typeof window !== 'undefined') return normalize(window.location.origin)
  return CANONICAL_FALLBACK
}

/**
 * Async variant for Server Components and Server Actions.
 * Uses next/headers to read the real request host so localhost URLs are
 * accurate in development even when NEXT_PUBLIC_SITE_URL is not set.
 *
 * Order: NEXT_PUBLIC_SITE_URL → x-forwarded-host header → host header.
 */
export async function getSiteOriginFromHeaders(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return normalize(configured)

  const { headers } = await import('next/headers')
  const hdrs = await headers()

  const forwardedHost = hdrs.get('x-forwarded-host')
  if (forwardedHost) {
    const proto = hdrs.get('x-forwarded-proto') ?? 'https'
    return normalize(`${proto}://${forwardedHost}`)
  }

  const host = hdrs.get('host')
  if (host) {
    const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
    return normalize(`${proto}://${host}`)
  }

  return CANONICAL_FALLBACK
}

/**
 * Resolve the public origin for an inbound request inside a Route Handler.
 * Order: configured site URL → reverse-proxy forwarded host → request origin.
 */
export function resolveRequestOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return normalize(configured)

  const forwardedHost = request.headers.get('x-forwarded-host')
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    return normalize(`${proto}://${forwardedHost}`)
  }

  return normalize(new URL(request.url).origin)
}

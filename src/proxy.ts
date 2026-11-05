import { NextResponse, type NextRequest } from 'next/server'
import { getClientIp } from '@/lib/request-ip'
import { banRemainingMs, checkTrap } from '@/lib/security/bot-defense'
import { ORG_HEADER, orgPath, resolveRequestOrgId, splitOrgPath } from '@/lib/org/request-org'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session-cookie'

/**
 * Bot defense, ahead of everything else (pages + the anonymous public APIs):
 * a banned IP gets 403, a scanner probing a trap path (/.env, /.git/,
 * xmlrpc.php, …) gets 404 and an escalating ban. Pure in-memory work — no
 * network, no database. /api/health is never blocked so the Coolify health
 * check cannot be locked out. See src/lib/security/bot-defense.ts.
 */
function botDefense(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl
  if (pathname === '/api/health') return null
  const ip = getClientIp(request)
  const remaining = banRemainingMs(ip)
  if (remaining > 0) {
    return new NextResponse('Forbidden', {
      status: 403,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': String(Math.ceil(remaining / 1000)) },
    })
  }
  if (checkTrap(pathname, ip, request.headers.get('user-agent')).trapped) {
    return new NextResponse('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return null
}

/**
 * Request proxy (Next.js 16's successor to `middleware.ts`).
 *
 * What it does, in order: bot defense, the per-tab org pin (`/o/<org-id>/...`
 * rewritten with the org forwarded in a header), and keeping the session cookie
 * alive. It does NOT do auth gating; that stays in layouts, pages, route
 * handlers and server actions, which call the cached `getUser()`.
 *
 * Why it touches the session cookie: the session is a 30-day rolling cookie
 * (see src/lib/auth/session.ts). The database row's expiry is pushed out by
 * `resolveSession`, but Server Components cannot write cookies, so without this
 * the browser would drop the cookie 30 days after sign-in no matter how active
 * the user is. The proxy re-sends the same value with a fresh max-age on page
 * requests. It is pure string work: no network and no database. The cookie is
 * not validated here; an invalid value is rejected by `getUser()` and simply
 * goes stale.
 */
export async function proxy(request: NextRequest) {
  // Browsers never send an Authorization header to a page, so one here is an
  // API client or credential probe aimed at the wrong path. Log its shape
  // (never the credential) so it can be told apart from a real failure.
  const authHeader = request.headers.get('authorization')
  if (authHeader) {
    console.warn(
      `[proxy] ${request.method} ${request.nextUrl.pathname} with auth=${authHeader.split(' ')[0] || 'raw'}` +
        ` ua="${request.headers.get('user-agent') ?? ''}"`,
    )
  }

  const blocked = botDefense(request)
  if (blocked) {
    if (authHeader) console.warn(`[proxy] blocked ${request.nextUrl.pathname} with status ${blocked.status}`)
    return blocked
  }

  // Per-tab org (see src/lib/org/request-org.ts). `/o/<org-id>/<route>` is
  // rewritten to `/<route>` with the org forwarded in a request header; the
  // server Supabase client hands it to get_current_org_id(), which honours it
  // only for a member. Unprefixed requests keep an org from the header/Referer
  // when they come from an org-pinned tab.
  const pinned = splitOrgPath(request.nextUrl.pathname)
  if (pinned && (pinned.rest === '' || pinned.rest === '/')) {
    const url = request.nextUrl.clone()
    url.pathname = orgPath(pinned.orgId, '/dashboard')
    return NextResponse.redirect(url)
  }
  const orgId =
    pinned?.orgId ??
    resolveRequestOrgId({
      header: request.headers.get(ORG_HEADER),
      referer: request.headers.get('referer'),
      host: request.headers.get('host'),
    })
  const rewriteUrl = pinned ? request.nextUrl.clone() : null
  if (rewriteUrl && pinned) rewriteUrl.pathname = pinned.rest

  const forward = () => {
    const headers = new Headers(request.headers)
    if (orgId) headers.set(ORG_HEADER, orgId)
    else headers.delete(ORG_HEADER)
    return rewriteUrl
      ? NextResponse.rewrite(rewriteUrl, { request: { headers } })
      : NextResponse.next({ request: { headers } })
  }

  // API routes only need the bot check: webhooks and the public API carry no
  // user session, and the auth routes set the cookie themselves.
  if ((pinned?.rest ?? request.nextUrl.pathname).startsWith('/api/')) {
    return pinned ? forward() : NextResponse.next()
  }

  const response = forward()

  const session = request.cookies.get(SESSION_COOKIE)?.value
  if (session) response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions())

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes (webhooks/public API have no user session; also keeps
     *   large upload bodies out of the proxy, which buffers request bodies)
     * - Next.js internals and static assets
     * - the service worker and PWA manifest
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    // Public, anonymous, small-JSON endpoints: bot defense only (proxy()
    // returns before the session refresh for /api/*).
    '/api/chat/:path*',
    '/api/widget/:path*',
    '/api/analytics/:path*',
  ],
}

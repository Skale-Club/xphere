import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getClientIp } from '@/lib/request-ip'
import { banRemainingMs, checkTrap } from '@/lib/security/bot-defense'

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
 * Session-refresh proxy (Next.js 16's successor to `middleware.ts`, required by
 * @supabase/ssr).
 *
 * Server Components cannot write cookies — `src/lib/supabase/server.ts`
 * swallows the cookie write in a try/catch for exactly that reason. That means
 * when a short-lived access token expires, a Server Component can refresh it in
 * memory but cannot persist the rotated tokens. With refresh-token rotation on
 * (Supabase default) the old token is then invalid on the next request and the
 * user appears randomly logged out — and can trigger a redirect ping-pong
 * between "/" and "/dashboard".
 *
 * This proxy runs on every page request, refreshes the session when its access
 * token is about to expire, and writes the refreshed cookies onto the outgoing
 * response. It does NOT do auth gating — that stays in layouts/pages/route
 * handlers/server actions, per the project's architecture, and every one of
 * those still calls the cached `getUser()` which validates the token against
 * the Auth server. Its only job is keeping the session cookies fresh.
 *
 * WHY getSession() AND NOT getUser() HERE: getUser() always makes a network
 * round-trip to the Auth server (us-west-2) — one per page request, plus one
 * per <Link> prefetch, which the dashboard sidebar fires ~20 of on every load.
 * That is pure latency on the critical path of the post-login render and
 * ~100 Auth calls/min under a single user. getSession() reads the cookie and
 * only hits the network to refresh when the token is inside the expiry margin,
 * which is exactly the one case this proxy exists for. The trusted check stays
 * in getUser() at the gate.
 */
export async function proxy(request: NextRequest) {
  const blocked = botDefense(request)
  if (blocked) return blocked
  // API routes only needed the bot check: webhooks and the public API carry no
  // user session, and refreshing one would cost an Auth call per webhook hit.
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do not run code between createServerClient and getSession — when the token
  // is expiring this refreshes the session and the refreshed cookies must land
  // on `response` untouched. The returned session is deliberately not read:
  // nothing here trusts it.
  await supabase.auth.getSession()

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

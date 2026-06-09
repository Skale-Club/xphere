import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
 * This proxy runs on every page request, calls getUser() to refresh the
 * session, and writes the refreshed cookies onto the outgoing response. It does
 * NOT do auth gating — that stays in layouts/pages/route handlers/server
 * actions, per the project's architecture. Its only job is keeping the session
 * cookies fresh.
 */
export async function proxy(request: NextRequest) {
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

  // Do not run code between createServerClient and getUser — it refreshes the
  // session and the refreshed cookies must land on `response` untouched.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes (webhooks/public API have no user session; avoids an auth
     *   network call on every webhook hit)
     * - Next.js internals and static assets
     * - the service worker and PWA manifest
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}

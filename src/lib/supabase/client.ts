import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { withTabOrgHeader } from '@/lib/org/tab-org'
import type { Database } from '@/types/database'

// The browser holds no Supabase session. The app session lives in an httpOnly
// cookie, and /api/auth/token hands out a short-lived JWT for PostgREST, Storage
// and Realtime. It is cached in memory and renewed shortly before it expires.

const REFRESH_MARGIN_MS = 5 * 60 * 1000

let cachedToken: { token: string; expiresAt: number } | null = null
let inflight: Promise<string | null> | null = null

async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/token', { credentials: 'same-origin', cache: 'no-store' })
    if (!res.ok) {
      // 401 means signed out; any other status is treated the same way so a
      // flaky response never leaves a stale token in use.
      cachedToken = null
      return null
    }
    const body = (await res.json()) as { token?: string | null; expiresAt?: number }
    if (!body.token || typeof body.expiresAt !== 'number') {
      cachedToken = null
      return null
    }
    // expiresAt is in seconds, like the JWT exp claim.
    cachedToken = { token: body.token, expiresAt: body.expiresAt * 1000 }
    return body.token
  } catch {
    // Network error: keep a still-valid token if there is one.
    return cachedToken && cachedToken.expiresAt > Date.now() ? cachedToken.token : null
  }
}

/** The current access token, fetching or renewing it when needed. Null when signed out. */
export function getBrowserToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return Promise.resolve(cachedToken.token)
  }
  // Concurrent callers (every query, every channel join) share one request.
  inflight ??= fetchToken().finally(() => {
    inflight = null
  })
  return inflight
}

/** Forget the cached token. Call on sign-out so the next query is anonymous. */
export function clearBrowserToken(): void {
  cachedToken = null
}

function create() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      accessToken: () => getBrowserToken(),
      // Scope browser-side queries to this tab's org (get_current_org_id()
      // honours the header for members only). Read per request, not at
      // creation: the browser client is a singleton shared by the whole tab.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, headers: withTabOrgHeader(init?.headers) }),
      },
    },
  )
}

type BrowserClient = ReturnType<typeof create>

let browserClient: BrowserClient | null = null

export function createClient(): BrowserClient {
  // Server renders of client components: a fresh, unpatched client per call.
  if (typeof window === 'undefined') return create()
  if (browserClient) return browserClient

  const client = create()

  // Realtime must join channels with the USER's token. realtime-js builds the
  // join payload synchronously from whatever token it has cached, while the
  // token itself is fetched asynchronously. A channel subscribed in that window
  // joins with the anon key, Realtime stores the subscription as role `anon`
  // and every RLS-protected change (notifications, conversations, …) is
  // silently dropped for the life of the page. So every subscribe() waits for
  // the first token resolution; later refreshes are pushed to joined channels
  // by supabase-js itself. With the `accessToken` option, setAuth() without an
  // argument calls that callback (realtime-js _performAuth).
  const authReady = client.realtime.setAuth().catch(() => {})
  const openChannel = client.channel.bind(client)
  client.channel = ((...args: Parameters<BrowserClient['channel']>) => {
    const channel = openChannel(...args)
    const subscribe = channel.subscribe.bind(channel)
    channel.subscribe = ((...subscribeArgs: Parameters<typeof channel.subscribe>) => {
      void authReady.then(() => {
        // Removed (component unmounted) while we waited: don't resurrect it.
        if (client.getChannels().includes(channel)) subscribe(...subscribeArgs)
      })
      return channel
    }) as typeof channel.subscribe
    return channel
  }) as BrowserClient['channel']

  // supabase-js only re-pushes a token to joined channels on Supabase Auth
  // events, which this client never emits. The token lives an hour, so renew it
  // ahead of time and hand the new one to Realtime. Skipped when signed out.
  setInterval(() => {
    if (!cachedToken) return
    void client.realtime.setAuth().catch(() => {})
  }, 2 * 60 * 1000)

  browserClient = client
  return client
}

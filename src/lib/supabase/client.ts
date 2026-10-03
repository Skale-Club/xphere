import { createBrowserClient } from '@supabase/ssr'
import { withTabOrgHeader } from '@/lib/org/tab-org'
import type { Database } from '@/types/database'

function create() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Scope browser-side queries to this tab's org (get_current_org_id()
      // honours the header for members only). Read per request, not at
      // creation: the browser client is a singleton shared by the whole tab.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, headers: withTabOrgHeader(init?.headers) }),
      },
    }
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
  // token itself is fetched asynchronously (getSession — slow when it has to
  // refresh an expired access token). A channel subscribed in that window
  // joins with the anon key, Realtime stores the subscription as role `anon`
  // and every RLS-protected change (notifications, conversations, …) is
  // silently dropped for the life of the page. So every subscribe() waits for
  // the first token resolution; later refreshes are pushed to joined channels
  // by supabase-js itself.
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

  browserClient = client
  return client
}

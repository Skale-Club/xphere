import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { ORG_HEADER, resolveRequestOrgId } from '@/lib/org/request-org'
import type { Database } from '@/types/database'

// cache() deduplicates calls within a single server-side render tree.
// No matter how many server actions call createClient() or getUser(),
// only one Supabase client is created and only one auth network call is made per request.

export const createClient = cache(async () => {
  const cookieStore = await cookies()
  // The org this request's tab is pinned to (URL prefix via the proxy, the
  // tab's fetch header, or its Referer). get_current_org_id() honours it only
  // for a member; absent, the DB default applies. See src/lib/org/request-org.ts.
  const headerStore = await headers()
  const orgId = resolveRequestOrgId({
    header: headerStore.get(ORG_HEADER),
    referer: headerStore.get('referer'),
    host: headerStore.get('host'),
  })
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(orgId ? { global: { headers: { [ORG_HEADER]: orgId } } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component renders cannot mutate response cookies directly.
            // Cookie writes still work in route handlers and server actions.
          }
        },
      },
    }
  )
})

// Single cached auth call per request | replaces supabase.auth.getUser() at every call site
export const getUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

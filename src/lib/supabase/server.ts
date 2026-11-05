import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { ORG_HEADER, resolveRequestOrgId } from '@/lib/org/request-org'
import { SESSION_COOKIE } from '@/lib/auth/session-cookie'
import { resolveSession } from '@/lib/auth/session'
import { mintSupabaseJwt } from '@/lib/auth/supabase-jwt'
import type { AppUser } from '@/lib/auth/users'
import type { Database } from '@/types/database'

// cache() deduplicates calls within a single server-side render tree.
// No matter how many server actions call createClient() or getUser(),
// only one session lookup and one Supabase client are made per request.

export const createClient = cache(async () => {
  // The org this request's tab is pinned to (URL prefix via the proxy, the
  // tab's fetch header, or its Referer). get_current_org_id() honours it only
  // for a member; absent, the DB default applies. See src/lib/org/request-org.ts.
  const [headerStore, user] = await Promise.all([headers(), getUser()])
  const orgId = resolveRequestOrgId({
    header: headerStore.get(ORG_HEADER),
    referer: headerStore.get('referer'),
    host: headerStore.get('host'),
  })
  return buildClient(orgId, user)
})

/**
 * User client pinned to an org the request itself cannot carry — e.g. a
 * third-party callback returning to us, which has no prefix, header or
 * same-origin Referer. Store the org when the flow starts and pass it here.
 * Like the header, it is only a selector: get_current_org_id() ignores an org
 * the user is not a member of (migration 1308).
 */
export async function createClientForOrg(orgId: string | null) {
  return buildClient(orgId, await getUser())
}

function buildClient(orgId: string | null, user: AppUser | null) {
  // Signed lazily and once per client: a request that never queries Supabase
  // pays nothing, and one that queries it many times signs a single token.
  let jwt: Promise<string | null> | null = null
  const accessToken = () => {
    if (!user) return Promise.resolve(null)
    jwt ??= mintSupabaseJwt(user).then((minted) => minted.token)
    return jwt
  }
  // A null token makes supabase-js fall back to the publishable (anon) key, so
  // public pages keep working without a session.
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(orgId ? { global: { headers: { [ORG_HEADER]: orgId } } } : {}),
      accessToken,
    },
  )
}

/** The raw session cookie value, or null when the request carries none. */
export const getSessionToken = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE)?.value ?? null
})

// Single cached session lookup per request | replaces supabase.auth.getUser() at every call site.
// One indexed read of app_sessions joined to users; no network call to an Auth server.
export const getUser = cache(async (): Promise<AppUser | null> => {
  const token = await getSessionToken()
  return token ? resolveSession(token) : null
})

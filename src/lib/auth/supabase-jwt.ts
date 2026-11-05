import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppUser } from '@/lib/auth/users'

// Temporary bridge. The database trusts only Supabase-issued tokens until it leaves Supabase,
// so the server asks Supabase for one with the service role key; the sign-in itself never
// touches Supabase Auth. Delete this file (and the auth.users shadow rows) with Supabase.

export const TOKEN_TTL_SECONDS = 60 * 60

// Reuse a token while more than this remains, so a request never starts with one about to expire.
const REFRESH_MARGIN_SECONDS = 5 * 60

type Cached = { token: string; expiresAt: number }

const cache = new Map<string, Cached>()
// Concurrent requests for the same user share one fetch. Entries are removed when the
// promise settles, so a failure is never cached.
const inflight = new Map<string, Promise<Cached>>()

const AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false } as const

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: AUTH_OPTIONS,
  })
}

function publicClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: AUTH_OPTIONS },
  )
}

async function fetchToken(user: AppUser): Promise<Cached> {
  if (!user.email) throw new Error('mintSupabaseJwt: user has no email, cannot obtain a database token')

  // generateLink sends no email: it only returns the one-time hash we exchange right away.
  const { data: link, error: linkError } = await adminClient().auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) {
    throw new Error(`mintSupabaseJwt: generateLink failed: ${linkError?.message ?? 'no hashed_token'}`)
  }

  const { data: verified, error: verifyError } = await publicClient().auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  })
  const session = verified?.session
  if (verifyError || !session?.access_token) {
    throw new Error(`mintSupabaseJwt: verifyOtp failed: ${verifyError?.message ?? 'no session'}`)
  }

  const token = session.access_token
  const expiresAt = Math.floor(Date.now() / 1000) + (session.expires_in ?? TOKEN_TTL_SECONDS)

  // Each verify leaves a row in auth.sessions, and one per user per hour would pile up. A local
  // logout deletes that row while the access token stays valid until it expires.
  // Fire-and-forget: a failed cleanup must not fail the request.
  void fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      Authorization: `Bearer ${token}`,
    },
  }).then(
    () => undefined,
    () => undefined,
  )

  return { token, expiresAt }
}

export async function mintSupabaseJwt(user: AppUser): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000)
  const hit = cache.get(user.id)
  if (hit && hit.expiresAt - now > REFRESH_MARGIN_SECONDS) return hit

  const pending = inflight.get(user.id)
  if (pending) return pending

  const promise = fetchToken(user)
    .then((fresh) => {
      // Dropping expired entries here keeps the map from growing for the life of the process.
      for (const [id, entry] of cache) if (entry.expiresAt <= now) cache.delete(id)
      cache.set(user.id, fresh)
      return fresh
    })
    .finally(() => {
      inflight.delete(user.id)
    })
  inflight.set(user.id, promise)
  return promise
}

/**
 * Creates the auth.users row that lets the bridge issue tokens for this account. No password:
 * the account can only ever be reached through the app's own sign-in. An email already in
 * auth.users is refused rather than reused, so a new account never inherits an old one's data.
 */
export async function createAuthShadow(input: { id?: string; email: string }): Promise<string> {
  const email = input.email.trim().toLowerCase()
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.createUser({
    ...(input.id ? { id: input.id } : {}),
    email,
    email_confirm: true,
  })
  if (data?.user?.id) return data.user.id
  throw new Error(`createAuthShadow failed: ${error?.message ?? 'no user'}`)
}

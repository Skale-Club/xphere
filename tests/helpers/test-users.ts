// Integration-test identities for the app-owned auth model (migration 1336).
//
// An account is a public.users row plus an auth.users shadow row with the same id.
// The shadow exists only because the database trusts Supabase-issued tokens until it
// leaves Supabase: a test signs in through the same generateLink + verifyOtp flow as
// src/lib/auth/supabase-jwt.ts (repeated here because that module imports 'server-only').

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false } as const

/** Creates the auth.users shadow, then the public.users row with the same id. */
export async function createTestUser(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string }> {
  const { data: created, error: authError } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (authError || !created.user) throw authError ?? new Error('createTestUser: no auth user')
  const id = created.user.id
  const { error } = await admin.from('users').insert({ id, email })
  if (error) {
    await admin.auth.admin.deleteUser(id)
    throw error
  }
  return { id, email }
}

/** Removes both rows. Like the deletes it replaces, it does not throw on a DB error. */
export async function deleteTestUser(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from('users').delete().eq('id', id)
  await admin.auth.admin.deleteUser(id)
}

/**
 * A supabase-js client that acts as the given user under RLS. Pass the email, or the
 * user ({ email }) returned by createTestUser. `admin` is only needed for generateLink;
 * a service-role client is built from the environment when it is omitted.
 */
export async function signedInClient(
  who: string | { email: string },
  admin?: SupabaseClient,
): Promise<SupabaseClient> {
  const email = typeof who === 'string' ? who : who.email
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  const adminClient =
    admin ?? createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: AUTH_OPTIONS })

  const { data: link, error: linkError } = await adminClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkError || !link.properties?.hashed_token) {
    throw linkError ?? new Error('signedInClient: no hashed_token')
  }
  const { data, error } = await createClient(url, publishableKey, { auth: AUTH_OPTIONS }).auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  })
  if (error || !data.session) throw error ?? new Error('signedInClient: no session')
  const token = data.session.access_token

  return createClient(url, publishableKey, { auth: AUTH_OPTIONS, accessToken: async () => token })
}

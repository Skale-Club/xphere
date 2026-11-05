import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { randomOpaqueToken, sha256Hex } from '@/lib/mcp/crypto'
import { rowToAppUser, type AppUser } from '@/lib/auth/users'
import { SESSION_TTL_MS } from '@/lib/auth/session-cookie'

export { SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions } from '@/lib/auth/session-cookie'

// Touching the row on every request would add a write to each page render; an
// hour of drift is invisible against a 30-day lifetime.
const TOUCH_AFTER_MS = 60 * 60 * 1000

export { sha256Hex }

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomOpaqueToken(32)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  // Only the hash is stored, so a leaked database does not hand out sessions.
  const { error } = await createServiceRoleClient()
    .from('app_sessions')
    .insert({
      token_hash: await sha256Hex(token),
      user_id: userId,
      expires_at: expiresAt.toISOString(),
      user_agent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip ?? null,
    })
  if (error) throw new Error(`createSession failed: ${error.message}`)
  // Housekeeping at the one moment a row is added, so the table cannot grow without
  // a scheduled job. Not awaited: a failed cleanup must not fail a sign-in.
  void createServiceRoleClient()
    .from('app_sessions')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .then(
      () => undefined,
      () => undefined,
    )
  return { token, expiresAt }
}

export async function resolveSession(token: string): Promise<AppUser | null> {
  if (!token) return null
  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('app_sessions')
    .select('id, last_seen_at, expires_at, users!inner(id, email, phone, user_metadata, created_at, last_sign_in_at)')
    .eq('token_hash', await sha256Hex(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) {
    console.error('[session] lookup failed:', error.message)
    return null
  }
  if (!data) return null
  const joined = data.users as unknown
  const row = (Array.isArray(joined) ? joined[0] : joined) as Parameters<typeof rowToAppUser>[0] | undefined
  if (!row) return null

  if (Date.now() - new Date(data.last_seen_at).getTime() > TOUCH_AFTER_MS) {
    // Never awaited: the read path must not wait on a bookkeeping write.
    void admin
      .from('app_sessions')
      .update({
        last_seen_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      })
      .eq('id', data.id)
      .then(
        () => undefined,
        () => undefined,
      )
  }
  return rowToAppUser(row)
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return
  const { error } = await createServiceRoleClient()
    .from('app_sessions')
    .delete()
    .eq('token_hash', await sha256Hex(token))
  if (error) throw new Error(`destroySession failed: ${error.message}`)
}

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createAuthShadow } from '@/lib/auth/supabase-jwt'
import type { Json } from '@/types/database'

/**
 * The application's user. Shape-compatible with the fields the app used to read
 * off Supabase's User (id, email, phone, user_metadata) so call sites keep working.
 */
export type AppUser = {
  id: string
  email?: string
  phone?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user_metadata: Record<string, any>
  created_at: string
  last_sign_in_at?: string | null
}

type UserRow = {
  id: string
  email: string | null
  phone: string | null
  user_metadata: Json
  created_at: string
  last_sign_in_at: string | null
}

export const USER_COLUMNS = 'id, email, phone, user_metadata, created_at, last_sign_in_at'

export function rowToAppUser(row: UserRow): AppUser {
  const meta = row.user_metadata
  return {
    id: row.id,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    user_metadata:
      meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {},
    created_at: row.created_at,
    last_sign_in_at: row.last_sign_in_at,
  }
}

export async function getAppUserById(id: string): Promise<AppUser | null> {
  const { data, error } = await createServiceRoleClient()
    .from('users').select(USER_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(`getAppUserById failed: ${error.message}`)
  return data ? rowToAppUser(data) : null
}

export async function getAppUserByPhone(phone: string): Promise<AppUser | null> {
  const { data, error } = await createServiceRoleClient()
    .from('users').select(USER_COLUMNS).eq('phone', phone).maybeSingle()
  if (error) throw new Error(`getAppUserByPhone failed: ${error.message}`)
  return data ? rowToAppUser(data) : null
}

export async function getAppUserByEmail(email: string): Promise<AppUser | null> {
  // Emails are stored lowercase; the unique index is on lower(email).
  const { data, error } = await createServiceRoleClient()
    .from('users').select(USER_COLUMNS).eq('email', email.trim().toLowerCase()).maybeSingle()
  if (error) throw new Error(`getAppUserByEmail failed: ${error.message}`)
  return data ? rowToAppUser(data) : null
}

export async function listAppUsers(opts: { page?: number; perPage?: number } = {}): Promise<AppUser[]> {
  const page = Math.max(1, opts.page ?? 1)
  const perPage = Math.min(1000, Math.max(1, opts.perPage ?? 50))
  const { data, error } = await createServiceRoleClient()
    .from('users').select(USER_COLUMNS)
    .order('created_at', { ascending: true })
    .range((page - 1) * perPage, page * perPage - 1)
  if (error) throw new Error(`listAppUsers failed: ${error.message}`)
  return (data ?? []).map(rowToAppUser)
}

export async function createAppUser(input: {
  // Required: the database token bridge keys on the email, so an account without one
  // could never reach the database. Every new account comes from an invite, which has one.
  email: string
  phone: string
  user_metadata?: Record<string, unknown>
}): Promise<AppUser> {
  const email = input.email?.trim().toLowerCase()
  if (!email) throw new Error('createAppUser failed: email is required')
  // The shadow goes first so public.users reuses its id; a failed insert then leaves only an
  // unused auth.users row, which is harmless and gets reused on the next attempt.
  // With DB_JWT_SECRET set the app signs its own database tokens and auth.users no longer
  // exists (self-hosted Postgres), so the id is generated here instead.
  const id = process.env.DB_JWT_SECRET ? crypto.randomUUID() : await createAuthShadow({ email })
  const { data, error } = await createServiceRoleClient()
    .from('users')
    .insert({
      id,
      email,
      phone: input.phone,
      user_metadata: (input.user_metadata ?? {}) as Json,
    })
    .select(USER_COLUMNS)
    .single()
  if (error || !data) throw new Error(`createAppUser failed: ${error?.message ?? 'no row'}`)
  return rowToAppUser(data)
}

export async function setUserPhone(id: string, phone: string): Promise<void> {
  const { error } = await createServiceRoleClient()
    .from('users').update({ phone, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(`setUserPhone failed: ${error.message}`)
}

/** Merges `partial` into the stored metadata; keys not named are kept. */
export async function updateUserMetadata(id: string, partial: Record<string, unknown>): Promise<AppUser> {
  const current = await getAppUserById(id)
  if (!current) throw new Error('updateUserMetadata failed: user not found')
  const merged = { ...current.user_metadata, ...partial }
  const { data, error } = await createServiceRoleClient()
    .from('users')
    .update({ user_metadata: merged as Json, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(USER_COLUMNS)
    .single()
  if (error || !data) throw new Error(`updateUserMetadata failed: ${error?.message ?? 'no row'}`)
  return rowToAppUser(data)
}

export async function markSignedIn(id: string): Promise<void> {
  const { error } = await createServiceRoleClient()
    .from('users').update({ last_sign_in_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(`markSignedIn failed: ${error.message}`)
}

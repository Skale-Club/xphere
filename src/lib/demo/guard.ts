import 'server-only'

import { getUser } from '@/lib/supabase/server'
import { getDemoUserEmail } from '@/lib/demo/config'

/**
 * Read-only enforcement for the public demo (app layer).
 *
 * Defense-in-depth: the database also blocks writes from the demo user via
 * restrictive RLS policies (see migration 1114_demo_readonly.sql). These helpers
 * stop mutations early in server actions / API routes with a friendly message.
 */

/** True when the current request is authenticated as the shared demo user. */
export async function isDemoSession(): Promise<boolean> {
  const demoEmail = getDemoUserEmail()
  if (!demoEmail) return false
  const user = await getUser()
  return Boolean(user?.email && user.email.toLowerCase().trim() === demoEmail)
}

export type DemoDenied = { error: string }

export const DEMO_READONLY_MESSAGE =
  'This is a read-only demo. Create your own account to make changes.'

/**
 * Call at the top of a mutating server action. Returns a standardized error
 * object to surface to the caller, or null when the write is allowed.
 *
 *   const denied = await assertWritable()
 *   if (denied) return denied
 */
export async function assertWritable(): Promise<DemoDenied | null> {
  if (await isDemoSession()) {
    return { error: DEMO_READONLY_MESSAGE }
  }
  return null
}

/**
 * Throwing variant for mutations whose return type can't carry an error field.
 * Drop-in at the top of any server action: `await assertWritableOrThrow()`.
 */
export async function assertWritableOrThrow(): Promise<void> {
  if (await isDemoSession()) {
    throw new Error(DEMO_READONLY_MESSAGE)
  }
}

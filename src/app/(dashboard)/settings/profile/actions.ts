'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import { getActiveOrg } from '@/lib/org/active-org'
import { insertNotification } from '@/lib/notifications/insert'

const profileSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long').optional(),
  avatar_url: z.string().url().max(1024).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
})

const passwordSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
})

export interface ActionResult {
  ok: boolean
  error?: string
}

export async function updateProfile(input: z.infer<typeof profileSchema>): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const supabase = await createClient()
  // Build the metadata update partial | only include fields that were actually
  // provided, so an avatar-only save doesn't blank out the name.
  const metadata: Record<string, unknown> = {}
  if (parsed.data.full_name !== undefined) metadata.full_name = parsed.data.full_name
  if (parsed.data.avatar_url !== undefined) metadata.avatar_url = parsed.data.avatar_url
  if (parsed.data.phone !== undefined) metadata.phone = parsed.data.phone ?? ''

  if (Object.keys(metadata).length === 0) {
    return { ok: true }
  }

  const { error } = await supabase.auth.updateUser({ data: metadata })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Fires a test push to the current user's own devices only. Reuses the real
 * `incoming_call` path so it exercises the exact ring behavior (vibration +
 * Answer/Decline action buttons via the "incoming-" tag prefix). Scoped to the
 * caller's user id — never fans out to other org members.
 */
export async function sendTestPush(): Promise<ActionResult> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const org = await getActiveOrg()
  if (!org) return { ok: false, error: 'No active organization' }

  await insertNotification(
    org.id,
    'incoming_call',
    { caller_name: 'Chamada de teste', call_id: `test-${Date.now()}` },
    [user.id],
  )
  return { ok: true }
}

export async function updatePassword(input: z.infer<typeof passwordSchema>): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid password' }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

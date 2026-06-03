'use server'

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const profileSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens'),
  timezone: z.string().min(1),
})

export type SchedulingProfile = {
  user_id: string
  org_id: string
  slug: string
  timezone: string
  sync_mode: 'one_way' | 'two_way'
  default_location_type: 'google_meet' | 'my_address' | 'client_address' | 'phone'
  created_at: string
  updated_at: string
}

export async function updateSchedulingPreferences(input: {
  sync_mode?: 'one_way' | 'two_way'
  default_location_type?: 'google_meet' | 'my_address' | 'client_address' | 'phone'
}): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('scheduling_profiles')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/scheduling')
  return { ok: true, data: undefined }
}

export async function getSchedulingProfile(): Promise<ActionResult<SchedulingProfile | null>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('scheduling_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  // Cast: database.ts types predate the sync_mode / default_location_type columns.
  return { ok: true, data: data as SchedulingProfile | null }
}

export async function upsertSchedulingProfile(
  input: { slug: string; timezone: string },
): Promise<ActionResult<SchedulingProfile>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data, error } = await supabase
    .from('scheduling_profiles')
    .upsert(
      {
        user_id: user.id,
        org_id: orgId,
        slug: parsed.data.slug,
        timezone: parsed.data.timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select()
    .single()

  if (error) return { ok: false, error: error.message }
  revalidatePath('/scheduling')
  return { ok: true, data: data as SchedulingProfile }
}

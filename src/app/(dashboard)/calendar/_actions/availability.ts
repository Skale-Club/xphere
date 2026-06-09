'use server'

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type AvailabilityRow = {
  id: string
  user_id: string
  org_id: string
  day_of_week: number
  start_time: string
  end_time: string
  created_at: string
}

const availabilityItemSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  enabled: z.boolean(),
})

export type AvailabilityItem = z.infer<typeof availabilityItemSchema>

export async function getUserAvailability(): Promise<ActionResult<AvailabilityRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('user_availability')
    .select('*')
    .eq('user_id', user.id)
    .order('day_of_week')

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

// Save the full weekly availability schedule (upsert per day).
export async function saveAvailability(
  items: AvailabilityItem[],
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  // Delete all existing and re-insert enabled days
  const { error: delError } = await supabase
    .from('user_availability')
    .delete()
    .eq('user_id', user.id)

  if (delError) return { ok: false, error: delError.message }

  const enabledItems = items.filter((i) => i.enabled)
  if (enabledItems.length === 0) {
    revalidatePath('/calendar')
    return { ok: true, data: undefined }
  }

  const rows = enabledItems.map((item) => ({
    user_id: user.id,
    org_id: orgId,
    day_of_week: item.day_of_week,
    start_time: item.start_time,
    end_time: item.end_time,
  }))

  const { error: insertError } = await supabase.from('user_availability').insert(rows)
  if (insertError) return { ok: false, error: insertError.message }

  revalidatePath('/calendar')
  return { ok: true, data: undefined }
}

'use server'

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

const eventTypeSchema = z.object({
  title: z.string().min(1).max(100),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(2000).optional(),
  duration_minutes: z.number().int().min(5).max(480),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366F1'),
  location_type: z.enum(['video', 'phone', 'in_person']).default('video'),
  location_value: z.string().max(500).optional(),
  active: z.boolean().default(true),
  booking_type: z.enum(['personal', 'round_robin']).default('personal'),
})

export type EventTypeInput = z.infer<typeof eventTypeSchema>

export type EventTypeRow = {
  id: string
  org_id: string
  user_id: string
  title: string
  slug: string
  description: string | null
  duration_minutes: number
  color: string
  location_type: string
  location_value: string | null
  allowed_location_kinds: string[] | null
  active: boolean
  booking_type: 'personal' | 'round_robin'
  created_at: string
  updated_at: string
}

export async function getEventTypes(): Promise<ActionResult<EventTypeRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('event_types')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

export async function createEventType(
  input: EventTypeInput,
): Promise<ActionResult<EventTypeRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = eventTypeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const slug = parsed.data.slug ?? slugify(parsed.data.title)

  const { data, error } = await supabase
    .from('event_types')
    .insert({
      ...parsed.data,
      slug,
      org_id: orgId,
      user_id: user.id,
    })
    .select()
    .single()

  if (error) return { ok: false, error: error.message }
  revalidatePath('/calendar')
  return { ok: true, data }
}

export async function updateEventType(
  id: string,
  input: Partial<EventTypeInput>,
): Promise<ActionResult<EventTypeRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('event_types')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'not_found' }
  revalidatePath('/calendar')
  return { ok: true, data }
}

export async function deleteEventType(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('event_types')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/calendar')
  return { ok: true, data: undefined }
}

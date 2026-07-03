'use server'

/**
 * Server actions for the call_destinations registry (v3.5 phase 3).
 * Shared destinations are named org-level numbers ("Reception", "Store cell")
 * answered by several people; personal destinations resolve from a member's
 * call_settings and are usually addressed via `member` chain targets instead.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/rbac/server'

const E164_REGEX = /^\+[1-9]\d{6,14}$/

export interface CallDestinationOption {
  id: string
  name: string
  number: string | null
  kind: 'personal' | 'shared'
  user_id: string | null
}

export async function listCallDestinations(): Promise<CallDestinationOption[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('call_destinations')
    .select('id, name, number, kind, user_id')
    .eq('is_active', true)
    .order('name', { ascending: true })
  return (data ?? []) as CallDestinationOption[]
}

const CreateSharedSchema = z.object({
  name: z.string().trim().min(2, 'Give the destination a name.').max(60),
  number: z.string().regex(E164_REGEX, 'Number must be in E.164 format, e.g. +14155551234.'),
})

export async function createSharedDestination(input: {
  name: string
  number: string
}): Promise<{ destination?: CallDestinationOption; error?: string }> {
  const perm = await requirePermission('calls.manage')
  if (!perm.ok) return { error: perm.error ?? 'Not allowed.' }

  const parsed = CreateSharedSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid destination.' }
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  const { data, error } = await supabase
    .from('call_destinations')
    .insert({
      org_id: orgId as string,
      kind: 'shared',
      name: parsed.data.name,
      number: parsed.data.number,
    })
    .select('id, name, number, kind, user_id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/calls')
  return { destination: data as CallDestinationOption }
}

export async function archiveCallDestination(id: string): Promise<{ error?: string }> {
  const perm = await requirePermission('calls.manage')
  if (!perm.ok) return { error: perm.error ?? 'Not allowed.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('call_destinations')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/calls')
  return {}
}

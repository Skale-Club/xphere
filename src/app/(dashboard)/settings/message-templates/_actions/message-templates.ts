'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Json } from '@/types/database'

export interface ChannelOverrides {
  sms?: string
  email?: string
  whatsapp?: string
}

export interface MessageTemplateRow {
  id: string
  org_id: string
  name: string
  body: string
  channel_overrides: ChannelOverrides
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MessageTemplateInput {
  name: string
  body: string
  channel_overrides: ChannelOverrides
}

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

const LIST_PATH = '/settings/message-templates'

export async function listMessageTemplates(): Promise<ActionResult<MessageTemplateRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, org_id, name, body, channel_overrides, created_by, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as unknown as MessageTemplateRow[] }
}

export async function getMessageTemplate(id: string): Promise<ActionResult<MessageTemplateRow>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, org_id, name, body, channel_overrides, created_by, created_at, updated_at')
    .eq('id', id)
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }
  return { ok: true, data: data as unknown as MessageTemplateRow }
}

export async function createMessageTemplate(
  input: MessageTemplateInput,
): Promise<ActionResult<{ id: string }>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (!input.name.trim()) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data, error } = await supabase
    .from('message_templates')
    .insert({
      org_id: orgId as string,
      name: input.name.trim(),
      body: input.body,
      channel_overrides: input.channel_overrides as Json,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'create_failed' }
  revalidatePath(LIST_PATH)
  return { ok: true, data: { id: data.id } }
}

export async function updateMessageTemplate(
  id: string,
  input: MessageTemplateInput,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }
  if (!input.name.trim()) return { ok: false, error: 'name_required' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('message_templates')
    .update({
      name: input.name.trim(),
      body: input.body,
      channel_overrides: input.channel_overrides as Json,
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath(LIST_PATH)
  revalidatePath(`${LIST_PATH}/${id}`)
  return { ok: true, data: undefined }
}

export async function deleteMessageTemplate(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase.from('message_templates').delete().eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath(LIST_PATH)
  return { ok: true, data: undefined }
}

'use server'

/**
 * Server actions for managing Contact DND (Do Not Disturb).
 *
 * These are called from:
 *  - ContactDndSection (contact detail page)
 *  - ContactInfoPanel (chat right sidebar)
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'

export type DndChannelKey = 'sms' | 'email' | 'calls' | 'whatsapp' | 'all'

export interface SetDndInput {
  contactId: string
  /** Pass true to enable DND, false to remove it entirely. */
  enabled: boolean
  /** Which channels to block. Pass ['all'] to block everything. */
  channels?: DndChannelKey[]
  /** Optional reason/note. */
  note?: string
}

export interface DndActionResult {
  ok: boolean
  error?: string
}

/**
 * Enable or disable DND for a contact.
 *
 * - enabled=true: sets dnd_enabled=true, dnd_channels to the given array (default ['all']).
 * - enabled=false: clears all DND fields.
 */
export async function setContactDnd(input: SetDndInput): Promise<DndActionResult> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { contactId, enabled, channels = ['all'], note } = input
  if (!contactId) return { ok: false, error: 'Missing contactId' }

  const supabase = await createClient()

  const update = enabled
    ? {
        dnd_enabled: true,
        dnd_channels: channels as string[],
        dnd_note: note?.trim() || null,
        dnd_set_at: new Date().toISOString(),
        dnd_set_by: user.id,
      }
    : {
        dnd_enabled: false,
        dnd_channels: [] as string[],
        dnd_note: null as string | null,
        dnd_set_at: null as string | null,
        dnd_set_by: null as string | null,
      }

  const { error } = await supabase.from('contacts').update(update).eq('id', contactId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/contacts')
  revalidatePath(`/chat`)

  return { ok: true }
}

/**
 * Quick-toggle: flip a specific channel on or off in the contact's DND list.
 * If adding 'all', clears the individual channels. If removing the last channel, disables DND.
 */
export async function toggleDndChannel(
  contactId: string,
  channel: DndChannelKey,
  block: boolean,
): Promise<DndActionResult> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  if (!contactId) return { ok: false, error: 'Missing contactId' }

  const supabase = await createClient()

  const { data: contact, error: readErr } = await supabase
    .from('contacts')
    .select('dnd_channels')
    .eq('id', contactId)
    .maybeSingle()
  if (readErr || !contact) return { ok: false, error: readErr?.message ?? 'Contact not found' }

  let channels: string[] = contact.dnd_channels ?? []

  if (block) {
    if (channel === 'all') {
      channels = ['all']
    } else {
      // Remove 'all' if it was set and we're switching to per-channel
      channels = channels.filter((c) => c !== 'all')
      if (!channels.includes(channel)) channels.push(channel)
    }
  } else {
    channels = channels.filter((c) => c !== channel)
    // If 'all' was being removed along with everything, also clear it
    if (channel === 'all') channels = []
  }

  const enabled = channels.length > 0
  const { error } = await supabase.from('contacts').update({
    dnd_enabled: enabled,
    dnd_channels: channels,
    dnd_set_at: enabled ? new Date().toISOString() : null,
    dnd_set_by: enabled ? user.id : null,
  }).eq('id', contactId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/contacts')
  revalidatePath('/chat')

  return { ok: true }
}

/**
 * Get just the DND state for a single contact (used by the chat composer to
 * perform a pre-send check without loading the full contact).
 */
export async function getContactDnd(contactId: string): Promise<{
  dnd_enabled: boolean
  dnd_channels: string[]
  dnd_note: string | null
} | null> {
  const user = await getUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('contacts')
    .select('dnd_enabled, dnd_channels, dnd_note')
    .eq('id', contactId)
    .maybeSingle()

  return data ?? null
}

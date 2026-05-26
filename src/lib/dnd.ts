// src/lib/dnd.ts
// DND (Do Not Disturb) helper for contact communication blocking.
//
// checkDnd resolves whether a contact has DND enabled for a given channel.
// It is used by:
//  - Action engine executors (send_sms, send_whatsapp_message, send_email, etc.)
//  - Workflow nodes before executing outbound steps
//  - Chat composer (client-side pre-check via server action wrapper)

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/** Channel keys understood by the DND system. */
export type DndChannel = 'sms' | 'email' | 'calls' | 'whatsapp' | 'all'

export interface DndCheckResult {
  blocked: boolean
  reason?: string
  /** The contact's dnd_channels array (only populated when blocked=true for logging). */
  channels?: string[]
}

/**
 * Check if a contact has DND active for the given outbound channel.
 *
 * @param contactId - UUID of the contact to check
 * @param channel   - Channel being attempted (e.g. 'sms', 'email', 'whatsapp', 'calls')
 * @param supabase  - Authenticated Supabase client (RLS scoped to the active org)
 *
 * Returns { blocked: false } when:
 *  - contactId is missing or lookup fails (fail-open to avoid blocking legit sends)
 *  - contact.dnd_enabled is false
 *  - contact.dnd_channels does not include the channel or 'all'
 *
 * Returns { blocked: true, reason: 'dnd_blocked', channels } when DND is active for
 * the given channel. Callers MUST NOT send and SHOULD log a timeline event.
 */
export async function checkDnd(
  contactId: string | null | undefined,
  channel: string,
  supabase: SupabaseClient<Database>,
): Promise<DndCheckResult> {
  if (!contactId) return { blocked: false }

  const { data: contact, error } = await supabase
    .from('contacts')
    .select('dnd_enabled, dnd_channels')
    .eq('id', contactId)
    .maybeSingle()

  if (error || !contact) {
    // Fail-open: if we can't read the contact, allow the send
    console.warn(`[dnd] checkDnd: could not read contact ${contactId}:`, error?.message)
    return { blocked: false }
  }

  if (!contact.dnd_enabled) return { blocked: false }

  const channels: string[] = contact.dnd_channels ?? []
  const blocked = channels.includes('all') || channels.includes(channel)
  if (!blocked) return { blocked: false }

  return {
    blocked: true,
    reason: 'dnd_blocked',
    channels,
  }
}

/**
 * Build a human-readable description of why a send was blocked, suitable for
 * inserting as a conversation timeline event.
 */
export function dndBlockedMessage(channel: string): string {
  const label = DND_CHANNEL_LABELS[channel] ?? channel
  return `Message blocked — DND active for ${label}`
}

/** Display labels for channel keys. */
export const DND_CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  email: 'Email',
  calls: 'Calls',
  whatsapp: 'WhatsApp',
  all: 'all channels',
}

'use server'

import { createClient, getUser } from '@/lib/supabase/server'

/**
 * Cheap change probe for the inbox list: the newest `updated_at` and
 * `last_message_at` across the org's conversations, as two limit-1 reads that
 * run in parallel. The chat layout polls this every few seconds and only
 * refetches the full (joined, paginated) list when the value changes, with a
 * periodic forced refetch for the rare update that touches neither column.
 * Read with the member's own session, so RLS and the tab's org apply.
 * Returns null on any failure.
 */
export async function getInboxSignature(): Promise<string | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const [updated, messaged] = await Promise.all([
    supabase
      .from('conversations')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('conversations')
      .select('last_message_at')
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (updated.error || messaged.error) return null
  return `${updated.data?.updated_at ?? ''}|${messaged.data?.last_message_at ?? ''}`
}

export interface InboxPhoneNumber {
  id: string
  label: string
  e164: string
}

/** Active, non-archived Twilio numbers for the inbox phone filter. */
export async function listInboxPhoneNumbers(): Promise<InboxPhoneNumber[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('twilio_phone_numbers')
    .select('id, inbox_label, friendly_name, e164')
    .eq('is_active', true)
    .is('archived_at', null)
    .order('inbox_label')
  if (error || !data) return []
  return data.map((r) => ({
    id: r.id,
    label: r.inbox_label ?? r.friendly_name ?? '',
    e164: r.e164,
  }))
}

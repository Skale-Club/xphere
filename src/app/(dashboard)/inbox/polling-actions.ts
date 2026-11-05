'use server'

import { createClient, getUser } from '@/lib/supabase/server'

// The inbox change probe lives in GET /api/poll/inbox-signature (high-frequency
// polls avoid server actions, which serialize per client).

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

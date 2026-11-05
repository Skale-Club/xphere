'use server'

import { createClient, getUser } from '@/lib/supabase/server'

export interface PolledCallStatus {
  status: string | null
  durationSeconds: number | null
}

/**
 * Current status of one call, read from call_logs (updated by the Twilio status
 * webhook) with the member's own session, so RLS and the tab's org apply.
 * Returns null while the row does not exist yet or when the read fails.
 */
export async function fetchCallStatus(callSid: string): Promise<PolledCallStatus | null> {
  if (!callSid) return null
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('call_logs')
    .select('status, duration_seconds')
    .eq('call_sid', callSid)
    .maybeSingle()
  if (error || !data) return null
  return {
    status: data.status ?? null,
    durationSeconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : null,
  }
}

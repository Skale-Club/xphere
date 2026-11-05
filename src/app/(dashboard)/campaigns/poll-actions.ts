'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']

/** Upper bound per poll; a bigger burst is picked up by the next poll. */
const MAX_UPDATES_PER_POLL = 500

/**
 * Campaign contacts changed since `since` (an `updated_at` exactly as returned
 * by a previous call, so no precision is lost), oldest first so the caller can
 * advance its cursor to the last row. Read with the member's own session, so
 * RLS and the tab's org apply. Returns [] on any failure.
 */
export async function fetchCampaignContactUpdates(
  campaignId: string,
  since: string | null,
): Promise<CampaignContactRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  let query = supabase
    .from('campaign_contacts')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: true })
    .limit(MAX_UPDATES_PER_POLL)
  if (since) query = query.gt('updated_at', since)
  const { data, error } = await query
  if (error) return []
  return data ?? []
}

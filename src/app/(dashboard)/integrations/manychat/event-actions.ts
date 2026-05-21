'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type ManychatEventRow = Database['public']['Tables']['manychat_events']['Row']

export type ManychatEventsFilter = {
  status?: 'matched' | 'unmatched' | 'error'
  from?: string   // YYYY-MM-DD | inclusive start date (created_at >= from)
  to?: string     // YYYY-MM-DD | inclusive end date (created_at <= to + T23:59:59Z)
  offset?: number
  limit?: number
}

/**
 * Paginated fetch of manychat_events for the active org.
 *
 * RLS scopes to the active org automatically | no manual org_id filter.
 * Returns { events, total } where total is the full count (for pagination UI).
 * Default: 25 rows, offset 0, no filter.
 */
export async function getManychatEvents(
  filter: ManychatEventsFilter = {}
): Promise<{ events: ManychatEventRow[]; total: number }> {
  const user = await getUser()
  if (!user) return { events: [], total: 0 }

  const supabase = await createClient()
  const limit = filter.limit ?? 25
  const offset = filter.offset ?? 0

  let query = supabase
    .from('manychat_events')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filter.status) {
    query = query.eq('status', filter.status)
  }
  if (filter.from) {
    query = query.gte('created_at', `${filter.from}T00:00:00Z`)
  }
  if (filter.to) {
    query = query.lte('created_at', `${filter.to}T23:59:59Z`)
  }

  const { data, count, error } = await query

  if (error || !data) return { events: [], total: 0 }
  return { events: data as ManychatEventRow[], total: count ?? 0 }
}

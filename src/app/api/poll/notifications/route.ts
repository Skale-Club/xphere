// GET /api/poll/notifications?since=<ISO>
// The bell's poll. Returns this user's notifications created at or after
// `since` (the client passes its newest seen `created_at` minus an overlap and
// dedupes by id), newest first. Without `since` it returns the 30-day list.
// Route handler rather than a server action so the 3s poll never queues user
// clicks behind it. Member session, so RLS and the tab's org header apply.

import { createClient, getUser } from '@/lib/supabase/server'
import { isSafeTimestamp, pollBadRequest, pollJson, pollUnauthorized } from '@/lib/polling/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return pollUnauthorized()

  const since = new URL(request.url).searchParams.get('since')
  if (since !== null && !isSafeTimestamp(since)) return pollBadRequest('Invalid since')

  const lowerBound = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', lowerBound)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return pollJson({ error: 'Query failed' }, 500)
  return pollJson({ notifications: data ?? [] })
}

// GET /api/poll/inbox-signature
// Cheap change probe for the inbox list. One limit-1 read per status, each
// ordered by `last_message_at` and filtered by `status`, which is the
// `(org_id, status, last_message_at DESC NULLS LAST)` index from migration 1246
// (org_id comes from RLS), so every probe is an index lookup. `updated_at` has
// no index and is deliberately not probed: an update that touches no message
// time is picked up by the client's periodic full refresh.
// Member session, so RLS and the tab's org header apply.

import { createClient, getUser } from '@/lib/supabase/server'
import { pollJson, pollUnauthorized } from '@/lib/polling/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['open', 'pending', 'waiting', 'resolved', 'closed'] as const

export async function GET(): Promise<Response> {
  const user = await getUser()
  if (!user) return pollUnauthorized()

  const supabase = await createClient()
  const results = await Promise.all(
    STATUSES.map((status) =>
      supabase
        .from('conversations')
        .select('last_message_at')
        .eq('status', status)
        .not('last_message_at', 'is', null)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ),
  )
  if (results.some((r) => r.error)) return pollJson({ error: 'Query failed' }, 500)
  const signature = results.map((r) => r.data?.last_message_at ?? '').join('|')
  return pollJson({ signature })
}

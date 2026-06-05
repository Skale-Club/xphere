// GET /api/chat/unread-count
// Returns the number of INBOX ENTRIES that render as unread for the current user
// — one representative conversation per contact, exactly matching the dots the
// inbox shows. Computed by the inbox_unread_count() RPC (migration 1161), which
// counts inbox_entries rows whose representative is unread (keyed on inbound
// activity, so an operator's own reply never re-flags a thread). auth.uid()
// inside the RPC scopes the count to this user. Auth-gated; 401 if no session.

import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('inbox_unread_count')

  if (error) {
    // Log so a broken badge is observable instead of silently reading "all read".
    console.error('[GET /api/chat/unread-count] inbox_unread_count', error)
    return Response.json({ count: 0 })
  }

  return Response.json({ count: typeof data === 'number' ? data : 0 })
}

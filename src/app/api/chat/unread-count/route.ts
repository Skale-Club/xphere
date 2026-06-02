// GET /api/chat/unread-count
// Returns the number of conversations with unread messages for the current user.
// Auth-gated; 401 if no session.

import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const [convsRes, readsRes] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, last_message_at')
      .in('status', ['open', 'pending', 'waiting'])
      .not('last_message_at', 'is', null)
      .limit(1000),
    supabase
      .from('conversation_reads')
      .select('conversation_id, read_at')
      .eq('user_id', user.id),
  ])

  if (convsRes.error) return Response.json({ count: 0 })

  const readAtMap = new Map(
    (readsRes.data ?? []).map((r) => [r.conversation_id, r.read_at] as const),
  )

  const count = (convsRes.data ?? []).filter((c) => {
    const readAt = readAtMap.get(c.id)
    return !readAt || (c.last_message_at != null && c.last_message_at > readAt)
  }).length

  return Response.json({ count })
}

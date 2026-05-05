// GET /api/chat/conversations
// Returns all conversations for the active org, ordered by last activity.
// Auth-gated: returns 401 if no user session.
import { createClient, getUser } from '@/lib/supabase/server'
import type { ConversationSummary } from '@/types/chat'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const user = await getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, status, created_at, updated_at, last_message_at, visitor_name, visitor_email, visitor_phone, last_message, channel, channel_metadata, bot_status')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/chat/conversations]', error)
    return Response.json({ error: 'Failed to load conversations' }, { status: 500 })
  }

  // Secondary query: resolve page_name for Meta conversations
  const pageIds = [
    ...new Set(
      (data ?? [])
        .filter((r) => r.channel !== 'widget')
        .map((r) => (r.channel_metadata as Record<string, string>)?.page_id)
        .filter(Boolean) as string[]
    ),
  ]

  let pageNameMap: Record<string, string> = {}
  if (pageIds.length > 0) {
    const { data: channels } = await supabase
      .from('meta_channels')
      .select('page_id, page_name')
      .in('page_id', pageIds)
    for (const ch of channels ?? []) {
      pageNameMap[ch.page_id] = ch.page_name ?? ch.page_id
    }
  }

  const conversations: ConversationSummary[] = (data ?? []).map((row) => {
    const meta = (row.channel_metadata as Record<string, string>) ?? {}
    const pageId = meta?.page_id
    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at,
      visitorName: row.visitor_name,
      visitorEmail: row.visitor_email,
      visitorPhone: row.visitor_phone,
      lastMessage: row.last_message,
      channel: row.channel ?? 'widget',
      channelMetadata: meta,
      botStatus: (row.bot_status as string) ?? 'active',
      channelAccountName: pageId ? (pageNameMap[pageId] ?? pageId) : null,
    }
  })

  return Response.json({ conversations })
}

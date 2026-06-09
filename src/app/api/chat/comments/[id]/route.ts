export const runtime = 'nodejs'

import { createClient } from '@/lib/supabase/server'

export interface CommentRow {
  id: string
  visitorName: string | null
  contactId: string | null
  lastMessage: string | null
  lastMessageAt: string | null
  channelMetadata: Record<string, string | null>
  status: string | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: platformPostId } = await params
    const supabase = await createClient()
    const { data: orgIdData } = await supabase.rpc('get_current_org_id')
    const orgId = orgIdData as string | null
    if (!orgId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabase
      .from('conversations')
      .select('id, visitor_name, contact_id, last_message, last_message_at, channel_metadata, status')
      .eq('org_id', orgId)
      .order('last_message_at', { ascending: false })

    if (error) return Response.json({ error: error.message }, { status: 500 })

    const comments: CommentRow[] = (data ?? [])
      .filter((row) => {
        const meta = (row.channel_metadata ?? {}) as Record<string, string | null>
        return (
          meta.thread_type === 'comment' &&
          meta.zernio_platform_post_id === platformPostId
        )
      })
      .map((row) => ({
        id: row.id as string,
        visitorName: (row.visitor_name as string | null) ?? null,
        contactId: (row.contact_id as string | null) ?? null,
        lastMessage: (row.last_message as string | null) ?? null,
        lastMessageAt: (row.last_message_at as string | null) ?? null,
        channelMetadata: (row.channel_metadata ?? {}) as Record<string, string | null>,
        status: (row.status as string | null) ?? null,
      }))

    return Response.json({ comments })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

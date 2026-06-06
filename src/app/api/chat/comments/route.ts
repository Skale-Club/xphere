export const runtime = 'nodejs'

import { createClient } from '@/lib/supabase/server'

export interface PostSummary {
  platformPostId: string
  postId: string | null
  platform: string
  accountUsername: string | null
  commentCount: number
  lastCommentAt: string | null
  lastCommentText: string | null
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: orgIdData } = await supabase.rpc('get_current_org_id')
    const orgId = orgIdData as string | null
    if (!orgId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabase
      .from('conversations')
      .select('id, last_message, last_message_at, channel_metadata')
      .eq('org_id', orgId)
      .not('channel_metadata', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(500)

    if (error) return Response.json({ error: error.message }, { status: 500 })

    // Group by platformPostId in JS — avoids complex RPC for now
    const map = new Map<string, PostSummary>()
    for (const row of data ?? []) {
      const meta = (row.channel_metadata ?? {}) as Record<string, string | null>
      if (meta.thread_type !== 'comment') continue
      const platformPostId = meta.zernio_platform_post_id ?? ''
      if (!platformPostId) continue

      const existing = map.get(platformPostId)
      if (!existing) {
        map.set(platformPostId, {
          platformPostId,
          postId: meta.zernio_post_id ?? null,
          platform: meta.platform ?? 'instagram',
          accountUsername: meta.account_username ?? null,
          commentCount: 1,
          lastCommentAt: row.last_message_at ?? null,
          lastCommentText: row.last_message ?? null,
        })
      } else {
        existing.commentCount++
        const rowDate = row.last_message_at ?? ''
        const existingDate = existing.lastCommentAt ?? ''
        if (rowDate > existingDate) {
          existing.lastCommentAt = row.last_message_at ?? null
          existing.lastCommentText = row.last_message ?? null
        }
      }
    }

    const posts = Array.from(map.values()).sort((a, b) => {
      const da = a.lastCommentAt ?? ''
      const db = b.lastCommentAt ?? ''
      return db.localeCompare(da)
    })

    return Response.json({ posts })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

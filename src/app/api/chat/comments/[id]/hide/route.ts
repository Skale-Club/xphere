export const runtime = 'nodejs'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { zernioFetch } from '@/lib/zernio/client'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params
    const supabase = await createClient()
    const { data: orgIdData } = await supabase.rpc('get_current_org_id')
    const orgId = orgIdData as string | null
    if (!orgId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: conv } = await supabase
      .from('conversations')
      .select('channel_metadata')
      .eq('id', conversationId)
      .maybeSingle()

    if (!conv) return Response.json({ error: 'Not found' }, { status: 404 })

    const meta = (conv.channel_metadata ?? {}) as Record<string, string | null>
    const commentId = meta.zernio_comment_id
    const accountId = meta.account_id

    if (!commentId || !accountId) {
      return Response.json({ error: 'Missing comment or account ID' }, { status: 400 })
    }

    const serviceClient = createServiceRoleClient()
    const apiKey = await getProviderKey('zernio', orgId, serviceClient)
    if (!apiKey) return Response.json({ error: 'Zernio not configured' }, { status: 400 })

    await zernioFetch(
      `/inbox/comments/${encodeURIComponent(commentId)}/hide`,
      'POST',
      { accountId },
      apiKey,
    )

    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Admin chat | Inbox
// Auth: handled by (dashboard)/layout.tsx
import { redirect } from 'next/navigation'

import { ChatLayout } from '@/components/chat/chat-layout'
import { createClient, getUser } from '@/lib/supabase/server'
import { getActiveAgents } from '@/app/(dashboard)/agents/actions'
import { InboxTemplate } from '@/components/crm/entity-template'

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; conversation?: string; contact?: string }>
}) {
  const params = await searchParams
  if (params.tab === 'playground') redirect('/agents')

  // Resolve active org for Realtime subscription filter (defense-in-depth alongside RLS)
  const supabase = await createClient()
  const [{ data: activeOrgId }, user] = await Promise.all([
    supabase.rpc('get_current_org_id'),
    getUser(),
  ])

  // Detect if any comment-capable channel (Meta OAuth or Zernio) is connected
  const [{ data: metaCommentChannels }, { data: zernioRow }] = await Promise.all([
    supabase
      .from('meta_channels')
      .select('id')
      .eq('is_active', true)
      .in('channel_type', ['instagram', 'messenger'])
      .limit(1),
    supabase
      .from('integrations')
      .select('id')
      .eq('provider', 'zernio')
      .eq('is_active', true)
      .limit(1),
  ])
  const hasCommentsChannel =
    (metaCommentChannels?.length ?? 0) > 0 || (zernioRow?.length ?? 0) > 0

  // Resolve initial conversation:
  //  - explicit ?conversation=ID wins
  //  - else ?contact=ID → most-recent conversation for that contact
  let initialConversationId: string | null = params.conversation ?? null
  const initialContactId: string | null = params.contact ?? null
  if (!initialConversationId && initialContactId) {
    const { data: convRows } = await supabase
      .from('conversations')
      .select('id, created_at, updated_at, last_message_at')
      .eq('contact_id', initialContactId)
      .neq('status', 'closed')
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)
    const convRow = (convRows ?? []).sort((a, b) => {
      const ta = new Date(a.last_message_at ?? a.updated_at ?? a.created_at).getTime()
      const tb = new Date(b.last_message_at ?? b.updated_at ?? b.created_at).getTime()
      return tb - ta
    })[0]
    initialConversationId = (convRow?.id as string | undefined) ?? null
  }

  // OBS-08: Build agentMap (id → name) for message-level agent badges
  const agentList = await getActiveAgents()
  const agentMap: Record<string, string> = {}
  for (const a of agentList) {
    agentMap[a.id] = a.name
  }

  return (
    // Lock the chat tree to the viewport (minus the dashboard top bar h-14 = 3.5rem)
    // so each inner panel can scroll independently and the dashboard sidebar/top bar
    // never scroll out of view.
    // InboxTemplate marks this surface as the shared inbox context so Prospects can
    // reuse the same conversation thread and composer without duplicating the Inbox UI.
    <InboxTemplate className="h-[calc(100dvh-3.5rem)]">
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatLayout
          currentOrgId={(activeOrgId as string | null) ?? null}
          currentUserId={user?.id ?? null}
          currentUserName={
            (user?.user_metadata?.full_name as string | undefined) ??
            (user?.user_metadata?.name as string | undefined) ??
            user?.email ??
            ''
          }
          agentMap={agentMap}
          initialConversationId={initialConversationId}
          initialContactId={initialContactId}
          hasCommentsChannel={hasCommentsChannel}
        />
      </div>
    </InboxTemplate>
  )
}

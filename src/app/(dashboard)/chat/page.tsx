// Admin chat | Inbox
// Auth: handled by (dashboard)/layout.tsx
import { redirect } from 'next/navigation'

import { ChatLayout } from '@/components/chat/chat-layout'
import { createClient, getUser } from '@/lib/supabase/server'
import { getActiveAgents } from '@/app/(dashboard)/agents/actions'

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

  // Resolve initial conversation:
  //  - explicit ?conversation=ID wins
  //  - else ?contact=ID → most-recent conversation for that contact
  let initialConversationId: string | null = params.conversation ?? null
  const initialContactId: string | null = params.contact ?? null
  if (!initialConversationId && initialContactId) {
    const { data: convRow } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', initialContactId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
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
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatLayout
          currentOrgId={(activeOrgId as string | null) ?? null}
          currentUserId={user?.id ?? null}
          agentMap={agentMap}
          initialConversationId={initialConversationId}
          initialContactId={initialContactId}
        />
      </div>
    </div>
  )
}

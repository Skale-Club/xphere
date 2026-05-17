// Admin chat — Inbox tab + Playground tab
// Tab is URL-driven: ?tab=inbox (default) | ?tab=playground
// Auth: handled by (dashboard)/layout.tsx
import Link from 'next/link'
import { FlaskConical, Inbox } from 'lucide-react'

import { AdminChatLayout } from '@/components/chat/admin-chat-layout'
import { PlaygroundChat } from '@/components/chat/playground-chat'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { getPlaygroundConfig } from './actions'
import { getActiveAgents } from '@/app/(dashboard)/agents/actions'

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const params = await searchParams
  const tab = params.tab === 'playground' ? 'playground' : 'inbox'

  // Resolve active org for Realtime subscription filter (defense-in-depth alongside RLS)
  const supabase = await createClient()
  const { data: activeOrgId } = await supabase.rpc('get_current_org_id')

  // OBS-08: Build agentMap (id → name) for message-level agent badges
  const agentList = await getActiveAgents()
  const agentMap: Record<string, string> = {}
  for (const a of agentList) {
    agentMap[a.id] = a.name
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-bg-secondary/40 px-4 pt-3">
        <ChatTab href="/chat?tab=inbox" active={tab === 'inbox'} icon={Inbox}>
          Inbox
        </ChatTab>
        <ChatTab href="/chat?tab=playground" active={tab === 'playground'} icon={FlaskConical}>
          Playground
        </ChatTab>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'inbox' ? (
          <AdminChatLayout currentOrgId={activeOrgId ?? null} agentMap={agentMap} />
        ) : (
          <PlaygroundTab />
        )}
      </div>
    </div>
  )
}

function ChatTab({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string
  active: boolean
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        'relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-tertiary hover:text-text-secondary',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', active ? 'text-accent' : 'text-text-tertiary')} />
      {children}
    </Link>
  )
}

async function PlaygroundTab() {
  const config = await getPlaygroundConfig()
  if (!config) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-text-tertiary">
        Could not load playground — widget token not found.
      </div>
    )
  }
  return (
    <PlaygroundChat
      widgetToken={config.widgetToken}
      displayName={config.displayName}
      avatarUrl={config.avatarUrl}
    />
  )
}

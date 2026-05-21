// src/app/(dashboard)/conversations/[id]/page.tsx
// Phase 40 OBS-06: Conversation delegation tree page.
// Shows the full agent delegation tree for a specific conversation,
// with cost + latency annotated per node.

import { notFound } from 'next/navigation'
import { Workflow } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { getConversationDelegationTree } from '@/lib/agent-runtime/observability'
import { DelegationTree } from '@/components/conversations/delegation-tree'
import { StatusPill } from '@/components/design-system/status-pill'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

type Props = { params: Promise<{ id: string }> }

const CHANNEL_MAP: Record<string, Channel> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
  sms: 'sms',
  voice: 'voice',
  widget: 'web',
  web: 'web',
}

export default async function ConversationDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch the conversation | RLS ensures org-scoping automatically
  const { data: conversation } = await supabase
    .from('conversations')
    .select(
      'id, status, visitor_name, visitor_email, channel, created_at, last_message_at'
    )
    .eq('id', id)
    .maybeSingle()

  if (!conversation) notFound()

  const tree = await getConversationDelegationTree(id)

  const visitorLabel =
    conversation.visitor_name ??
    conversation.visitor_email ??
    'Anonymous Visitor'

  const channel: Channel = CHANNEL_MAP[conversation.channel ?? 'web'] ?? 'unknown'

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Conversation"
        eyebrowIcon={Workflow}
        back={{ href: '/chat', label: 'Back to inbox' }}
        title={<span className="truncate">{visitorLabel}</span>}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusPill tone={conversation.status === 'open' ? 'success' : 'idle'}>
              {conversation.status}
            </StatusPill>
            <ChannelBadge channel={channel} />
            <code className="font-mono text-[11px] text-text-tertiary">{id}</code>
          </span>
        }
      />

      <div className="space-y-3">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          Agent delegation tree
        </h2>
        <DelegationTree roots={tree} />
      </div>
    </PageContainer>
  )
}

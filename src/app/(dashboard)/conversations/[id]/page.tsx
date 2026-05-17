// src/app/(dashboard)/conversations/[id]/page.tsx
// Phase 40 OBS-06: Conversation delegation tree page.
// Shows the full agent delegation tree for a specific conversation,
// with cost + latency annotated per node.

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getConversationDelegationTree } from '@/lib/agent-runtime/observability'
import { DelegationTree } from '@/components/conversations/delegation-tree'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Props = { params: Promise<{ id: string }> }

export default async function ConversationDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch the conversation — RLS ensures org-scoping automatically
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

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href="/chat">
            <ChevronLeft className="h-4 w-4" />
            Back to Chat
          </Link>
        </Button>
      </div>

      {/* Conversation header */}
      <div>
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-lg font-semibold">{visitorLabel}</h1>
          <Badge variant="outline" className="text-xs capitalize">
            {conversation.status}
          </Badge>
          <Badge variant="outline" className="text-xs capitalize">
            {conversation.channel}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono">{id}</p>
      </div>

      {/* Delegation Tree */}
      <div>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
          Agent Delegation Tree
        </h2>
        <DelegationTree roots={tree} />
      </div>
    </div>
  )
}

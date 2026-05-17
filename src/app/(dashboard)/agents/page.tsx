import Link from 'next/link'
import { Bot, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { AgentsTable } from '@/components/agents/agents-table'
import { ChannelDefaultsCard } from '@/components/agents/channel-defaults-card'
import {
  getAgents,
  getActiveAgents,
  getChannelDefaults,
} from './actions'

export default async function AgentsPage() {
  const [agents, channelDefaults, activeAgents] = await Promise.all([
    getAgents(),
    getChannelDefaults(),
    getActiveAgents(),
  ])

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Agents"
        eyebrowIcon={Bot}
        title="Agents"
        description="Configure the chat agents that serve your text channels — pick models, attach tools, and route them to inboxes."
        actions={
          <Button asChild>
            <Link href="/agents/new">
              <Plus className="h-3.5 w-3.5" />
              New agent
            </Link>
          </Button>
        }
      />

      <ChannelDefaultsCard defaults={channelDefaults} agents={activeAgents} />

      <AgentsTable agents={agents} channelDefaults={channelDefaults} />
    </PageContainer>
  )
}

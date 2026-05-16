import Link from 'next/link'
import { Button } from '@/components/ui/button'
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
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure the chat agents that serve your text channels.
          </p>
        </div>
        <Button asChild>
          <Link href="/agents/new">New agent</Link>
        </Button>
      </div>

      <ChannelDefaultsCard defaults={channelDefaults} agents={activeAgents} />

      <AgentsTable agents={agents} channelDefaults={channelDefaults} />
    </div>
  )
}

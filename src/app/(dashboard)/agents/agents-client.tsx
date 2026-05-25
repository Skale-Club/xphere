'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { AgentsTable } from '@/components/agents/agents-table'
import type { AgentListItem } from './actions'
import type { AgentChannel } from '@/lib/agents/channels'

interface AgentsClientProps {
  agents: AgentListItem[]
  channelDefaults: Record<AgentChannel, string | null>
  defaultShowInactive: boolean
  settingsButton: React.ReactNode
}

export function AgentsClient({
  agents,
  channelDefaults,
  defaultShowInactive,
  settingsButton,
}: AgentsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showInactive, setShowInactive] = useState(defaultShowInactive)

  const visibleAgents = useMemo(
    () => (showInactive ? agents : agents.filter((a) => a.is_active)),
    [agents, showInactive]
  )

  function handleToggle(next: boolean) {
    setShowInactive(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next) {
      params.delete('showInactive')
    } else {
      params.set('showInactive', 'false')
    }
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  return (
    <>
      <div className="animate-fade-in flex items-center justify-between pt-6 pb-6">
        <Button asChild size="sm" className="h-8 w-8 px-0 sm:w-auto sm:px-3">
          <Link href="/agents/new">
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Agent</span>
          </Link>
        </Button>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={handleToggle}
            />
            <Label
              htmlFor="show-inactive"
              className="text-xs text-muted-foreground"
            >
              Show inactive
            </Label>
          </div>
          {settingsButton}
        </div>
      </div>

      <div className="pb-2">
        <AgentsTable agents={visibleAgents} channelDefaults={channelDefaults} />
      </div>
    </>
  )
}

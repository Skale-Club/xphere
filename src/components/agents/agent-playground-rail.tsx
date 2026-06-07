'use client'

// Persistent, collapsible "Test Your Bot" rail. Lives in the agent [id] layout
// so it stays mounted (and keeps its conversation) while the user moves between
// the agent's sections. Collapse state persists in localStorage.

import * as React from 'react'
import { ChevronRight, FlaskConical, PanelRightClose } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AgentPlayground } from './agent-playground'

interface AgentPlaygroundRailProps {
  agentId: string
  agentName: string
  /** When true, default to collapsed on first load (e.g. table-heavy pages). */
  defaultCollapsed?: boolean
}

const STORAGE_KEY = 'agent-playground-rail:collapsed'

export function AgentPlaygroundRail({
  agentId,
  agentName,
  defaultCollapsed = false,
}: AgentPlaygroundRailProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed)
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null) setCollapsed(stored === '1')
    setHydrated(true)
  }, [])

  const toggle = React.useCallback((next: boolean) => {
    setCollapsed(next)
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  }, [])

  // Avoid a flash before localStorage is read.
  if (!hydrated) {
    return <div className="hidden w-[420px] shrink-0 xl:block" aria-hidden />
  }

  if (collapsed) {
    return (
      <div className="hidden shrink-0 border-l border-border bg-bg-secondary/40 xl:flex">
        <button
          type="button"
          onClick={() => toggle(false)}
          className="flex w-10 flex-col items-center gap-2 py-3 text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary"
          aria-label="Open Test Your Bot"
          title="Open Test Your Bot"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
          <FlaskConical className="h-4 w-4 text-accent" />
          <span className="mt-1 text-[11px] font-medium [writing-mode:vertical-rl]">
            Test Your Bot
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="hidden w-[420px] shrink-0 flex-col border-l border-border bg-bg-secondary xl:flex">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-secondary">
          <FlaskConical className="h-3.5 w-3.5 text-accent" />
          Test Your Bot
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-text-tertiary"
          onClick={() => toggle(true)}
          aria-label="Collapse Test Your Bot"
          title="Collapse"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <div className={cn('min-h-0 flex-1')}>
        <AgentPlayground agentId={agentId} agentName={agentName} />
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bot,
  Circle,
  History,
  ListTree,
  Plus,
  Settings2,
  Sparkles,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSubSidebar } from '@/components/layout/sub-sidebar'
import type { AgentListItem } from '@/app/(dashboard)/agents/actions'

interface AgentsSubNavProps {
  agents: AgentListItem[]
}

function getCurrentAgentId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'agents') return null
  const id = parts[1]
  if (!id || id === 'new') return null
  return id
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  muted,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  muted?: boolean
}) {
  const { onNavigate } = useSubSidebar()

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'group relative flex min-w-0 items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[12.5px] transition-colors',
        active
          ? 'bg-accent/10 text-text-primary'
          : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
        muted && !active && 'text-text-tertiary',
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-[60%] w-[2.5px] -translate-y-1/2 rounded-r-full bg-accent" />
      )}
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          active ? 'text-accent' : muted ? 'text-text-tertiary' : 'text-text-tertiary',
        )}
      />
      <span className="truncate font-medium">{label}</span>
    </Link>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-2 text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
        <span>{title}</span>
        {typeof count === 'number' ? <span>{count}</span> : null}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

export function AgentsSubNav({ agents }: AgentsSubNavProps) {
  const pathname = usePathname()
  const currentAgentId = getCurrentAgentId(pathname)
  const currentAgent = currentAgentId
    ? agents.find((agent) => agent.id === currentAgentId)
    : null
  const activeAgents = agents.filter((agent) => agent.is_active)
  const inactiveAgents = agents.filter((agent) => !agent.is_active)
  const { onNavigate } = useSubSidebar()

  return (
    <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
      <div className="mb-3 grid grid-cols-[1fr_36px] gap-2 px-1">
        <Button asChild size="sm" className="h-9 justify-start gap-2 text-[12.5px] font-medium">
          <Link href="/agents/new" onClick={onNavigate}>
            <Plus className="h-3.5 w-3.5" />
            Agent
          </Link>
        </Button>
        <Button asChild variant="secondary" size="icon-sm" className="h-9 w-9">
          <Link href="/agents" onClick={onNavigate} aria-label="All agents" title="All agents">
            <Bot className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <Section title="Agents" count={agents.length}>
          <NavLink
            href="/agents"
            label="All agents"
            icon={Bot}
            active={pathname === '/agents'}
          />
          <NavLink
            href="/agents/new"
            label="New agent"
            icon={Plus}
            active={pathname === '/agents/new'}
          />
        </Section>

        {currentAgent ? (
          <Section title="Current agent">
            <div className="mb-1 truncate rounded-[8px] border border-border-subtle bg-bg-tertiary/40 px-2.5 py-2">
              <div className="truncate text-[12.5px] font-semibold text-text-primary">
                {currentAgent.name}
              </div>
              <div className="truncate font-mono text-[10.5px] text-text-tertiary">
                {currentAgent.slug}
              </div>
            </div>
            <NavLink
              href={`/agents/${currentAgent.id}`}
              label="Settings"
              icon={Settings2}
              active={pathname === `/agents/${currentAgent.id}`}
            />
            <NavLink
              href={`/agents/${currentAgent.id}/invocations`}
              label="Invocations"
              icon={ListTree}
              active={pathname === `/agents/${currentAgent.id}/invocations`}
            />
            <NavLink
              href={`/agents/${currentAgent.id}/prompt-history`}
              label="Prompt history"
              icon={History}
              active={pathname === `/agents/${currentAgent.id}/prompt-history`}
            />
          </Section>
        ) : null}

        <Section title="Active" count={activeAgents.length}>
          {activeAgents.map((agent) => (
            <NavLink
              key={agent.id}
              href={`/agents/${agent.id}`}
              label={agent.name}
              icon={Sparkles}
              active={currentAgentId === agent.id}
            />
          ))}
        </Section>

        {inactiveAgents.length > 0 ? (
          <Section title="Inactive" count={inactiveAgents.length}>
            {inactiveAgents.map((agent) => (
              <NavLink
                key={agent.id}
                href={`/agents/${agent.id}`}
                label={agent.name}
                icon={Circle}
                active={currentAgentId === agent.id}
                muted
              />
            ))}
          </Section>
        ) : null}
      </div>
    </nav>
  )
}

'use client'

// Agents sub-sidebar: a grouped, expandable tree.
//   - Active agents are organized into user-created groups (folders) via the
//     shared DraggableTreeNav (drag to file/reorder, rename, color/emoji).
//   - Each agent row expands to reveal its sections as children (Prompt &
//     Actions, Knowledge, Settings, Dashboard). Clicking the name navigates to
//     Prompt & Actions AND expands; the chevron alone only toggles. The
//     playground is always visible as a rail in the agent layout, so it is not
//     a sidebar item.
//   - Inactive agents are pulled into a collapsible "Inactive" group pinned at
//     the bottom (rendered via DraggableTreeNav's appendSection slot).

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BookOpen, Bot, ChevronRight, LayoutDashboard, MessageSquare, Plus, Settings2 } from 'lucide-react'

import {
  DraggableTreeNav,
  TreeNavChildLinks,
  type TreeNavChild,
  type TreeNavItem,
} from '@/components/layout/draggable-tree-nav'
import { useSubSidebar } from '@/components/layout/sub-sidebar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AgentListItem } from '@/app/(dashboard)/agents/actions'
import type { AgentGroupRow } from '@/types/database'
import {
  moveAgentToGroup,
  reorderAgentsInGroup,
  softDeleteAgent,
} from '@/app/(dashboard)/agents/actions'
import {
  deleteAgentGroup,
  renameAgentGroup,
  reorderAgentGroups,
  updateAgentGroupMeta,
} from '@/app/(dashboard)/agents/_actions/groups'
import { NewAgentGroupButton } from '@/components/agents/new-agent-group-button'
import { NewAgentDialog } from '@/components/agents/new-agent-dialog'

interface AgentItem extends TreeNavItem {
  is_active: boolean
  slug: string
}

/** The static sub-pages revealed when an agent row is expanded. Module-scope so
 *  the reference stays stable across renders (cheap, depends only on the id). */
function agentChildren(a: AgentItem): TreeNavChild[] {
  return [
    { label: 'Prompt & Actions', href: `/agents/${a.id}`, icon: <MessageSquare className="h-3 w-3" /> },
    { label: 'Knowledge', href: `/agents/${a.id}/knowledge`, icon: <BookOpen className="h-3 w-3" /> },
    { label: 'Settings', href: `/agents/${a.id}/settings`, icon: <Settings2 className="h-3 w-3" /> },
    { label: 'Dashboard', href: `/agents/${a.id}/dashboard`, icon: <LayoutDashboard className="h-3 w-3" /> },
  ]
}

function toItem(a: AgentListItem): AgentItem {
  return { id: a.id, name: a.name, group_id: a.group_id, is_active: a.is_active, slug: a.slug }
}

interface AgentsSubNavProps {
  agents: AgentListItem[]
  groups: AgentGroupRow[]
}

export function AgentsSubNav({ agents, groups }: AgentsSubNavProps) {
  const router = useRouter()
  const { onNavigate } = useSubSidebar()

  const activeAgents = agents.filter((a) => a.is_active).map(toItem)
  const inactiveAgents = agents.filter((a) => !a.is_active).map(toItem)

  return (
    <DraggableTreeNav<AgentItem>
      items={activeAgents}
      folders={groups}
      itemNoun="agent"
      enableFolderIcon
      getHref={(a) => `/agents/${a.id}`}
      renderItemIcon={() => <Bot className="h-3 w-3 text-text-tertiary" />}
      getItemChildren={agentChildren}
      deleteItemLabel="Deactivate"
      onDeleteItem={async (a) => {
        const res = await softDeleteAgent(a.id)
        if (res && 'error' in res && res.error) {
          toast.error(res.error)
          return
        }
        toast.success(`Deactivated "${a.name}"`)
        router.refresh()
      }}
      actions={{
        reorderFolders: reorderAgentGroups,
        deleteFolder: deleteAgentGroup,
        renameFolder: renameAgentGroup,
        updateFolderMeta: updateAgentGroupMeta,
        moveItemToFolder: moveAgentToGroup,
        reorderItemsInFolder: reorderAgentsInGroup,
      }}
      toolbar={
        <>
          <NewAgentDialog>
            <Button size="sm" className="h-6 flex-1 text-[11px] gap-1">
              <Plus className="h-3 w-3" />
              Agent
            </Button>
          </NewAgentDialog>
          <NewAgentGroupButton />
          <Button asChild variant="outline" size="sm" className="h-6 w-6 px-0">
            <Link href="/agents" onClick={onNavigate} aria-label="All agents" title="All agents">
              <Bot className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </>
      }
      appendSection={<InactiveAgentsSection agents={inactiveAgents} />}
      emptyState={
        <div className="px-4 py-8 text-center">
          <Bot className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
          <p className="text-[11px] text-text-tertiary">No active agents</p>
        </div>
      }
    />
  )
}

// ─── Inactive section (non-draggable, pinned at the bottom) ─────────────────────

function InactiveAgentsSection({ agents }: { agents: AgentItem[] }) {
  const pathname = usePathname()
  const anyActive = agents.some((a) => pathname.startsWith(`/agents/${a.id}`))
  const [open, setOpen] = React.useState(anyActive)
  React.useEffect(() => {
    if (anyActive) setOpen(true)
  }, [anyActive])

  if (agents.length === 0) return null

  return (
    <div className="mt-1 border-t border-border-subtle pt-1">
      <div className="flex items-center gap-1 rounded-[6px] px-1.5 py-1">
        <span className="w-3 shrink-0" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
          <span className="flex-1 min-w-0 truncate text-left">Inactive</span>
          <span className="text-[10px] tabular-nums shrink-0">{agents.length}</span>
        </button>
        <span className="w-5 shrink-0" />
      </div>
      {open && (
        <div className="pl-5">
          {agents.map((a) => (
            <InactiveAgentRow key={a.id} agent={a} />
          ))}
        </div>
      )}
    </div>
  )
}

function InactiveAgentRow({ agent }: { agent: AgentItem }) {
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()
  const href = `/agents/${agent.id}`
  const links = agentChildren(agent)
  const selfActive = pathname === href
  const childActive = links.some((c) => pathname === c.href || pathname.startsWith(c.href + '/'))
  const [open, setOpen] = React.useState(selfActive || childActive)
  React.useEffect(() => {
    if (selfActive || childActive) setOpen(true)
  }, [selfActive, childActive])

  return (
    <div className="flex flex-col">
      <div className="group relative flex items-center rounded-[6px]">
        {selfActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-[60%] w-[2px] rounded-r-full bg-accent" />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-1 flex h-5 w-4 shrink-0 items-center justify-center text-text-tertiary hover:text-text-secondary"
          aria-label={open ? 'Collapse' : 'Expand'}
          tabIndex={-1}
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        </button>
        <Link
          href={href}
          onClick={() => {
            onNavigate()
            setOpen(true)
          }}
          className={cn(
            'flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 text-[12px] rounded-[6px]',
            selfActive
              ? 'text-text-primary font-medium bg-accent/8'
              : 'text-text-tertiary hover:bg-bg-tertiary/60 hover:text-text-primary',
          )}
        >
          <span className="flex h-3 w-3 shrink-0 items-center justify-center">
            <Bot className="h-3 w-3" />
          </span>
          <span className="truncate">{agent.name}</span>
        </Link>
      </div>
      {open && <TreeNavChildLinks links={links} className="ml-[26px]" />}
    </div>
  )
}

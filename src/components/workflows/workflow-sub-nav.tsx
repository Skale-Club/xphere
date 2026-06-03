'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ScrollText, Trash } from 'lucide-react'
import {
  CursorClick,
  CalendarBlank,
  ClockCountdown,
  Lightning,
  WebhooksLogo,
  FlowArrow,
  type Icon,
} from '@phosphor-icons/react'
import {
  DraggableTreeNav,
  type TreeNavItem,
} from '@/components/layout/draggable-tree-nav'
import { useSubSidebar } from '@/components/layout/sub-sidebar'
import {
  deleteFolder,
  renameFolder,
  reorderFolders,
  updateFolderMeta,
} from '@/app/(dashboard)/workflows/_actions/folders'
import {
  moveWorkflowToFolder,
  reorderWorkflowsInFolder,
  softDeleteWorkflow,
} from '@/app/(dashboard)/workflows/_actions/workflows'
import { NewWorkflowButton } from '@/components/flows/new-workflow-button'
import { NewFolderButton } from '@/components/workflows/new-folder-button'

interface WorkflowItem extends TreeNavItem {
  kind: 'tool' | 'flow'
  trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
}

interface FolderItem {
  id: string
  name: string
  color: string | null
  icon: string | null
  parent_id: string | null
  position: number
}

interface Props {
  workflows: WorkflowItem[]
  folders: FolderItem[]
}

const TRIGGER_ICONS: Record<WorkflowItem['trigger_type'], Icon> = {
  tool_call: CursorClick,
  event: CalendarBlank,
  schedule: ClockCountdown,
  manual: Lightning,
  webhook_url: WebhooksLogo,
}

const TRIGGER_COLORS: Record<WorkflowItem['trigger_type'], string> = {
  tool_call: '#6366f1',
  event: '#f59e0b',
  schedule: '#06b6d4',
  manual: '#64748b',
  webhook_url: '#f97316',
}

function workflowHref(w: WorkflowItem) {
  return w.kind === 'flow' ? `/workflows/flows/${w.id}` : `/workflows/${w.id}`
}

export function WorkflowSubNav({ workflows, folders }: Props) {
  const router = useRouter()
  const { onNavigate } = useSubSidebar()

  return (
    <DraggableTreeNav<WorkflowItem>
      items={workflows}
      folders={folders}
      itemNoun="workflow"
      getHref={workflowHref}
      renderItemIcon={(w) => {
        const Icon = TRIGGER_ICONS[w.trigger_type]
        return <Icon className="h-3 w-3" weight="fill" style={{ color: TRIGGER_COLORS[w.trigger_type] }} />
      }}
      onDeleteItem={async (w) => {
        const res = await softDeleteWorkflow(w.id)
        if (!res.ok) {
          toast.error(res.error ?? 'Failed to delete')
          return
        }
        toast.success(`Moved "${w.name}" to trash`)
        router.refresh()
      }}
      actions={{
        reorderFolders,
        deleteFolder,
        renameFolder,
        updateFolderMeta,
        moveItemToFolder: moveWorkflowToFolder,
        reorderItemsInFolder: reorderWorkflowsInFolder,
      }}
      toolbar={
        <>
          <NewWorkflowButton label="Workflow" className="h-6 flex-1 text-[11px]" />
          <NewFolderButton iconOnly className="h-6 w-6 px-0" />
        </>
      }
      footer={
        <>
          <Link
            href="/workflows/logs"
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[12px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
          >
            <ScrollText className="h-3.5 w-3.5" />
            Logs
          </Link>
          <Link
            href="/workflows/trash"
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[12px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
          >
            <Trash className="h-3.5 w-3.5" />
            Trash
          </Link>
        </>
      }
      emptyState={
        <div className="px-4 py-8 text-center">
          <FlowArrow className="mx-auto mb-2 h-6 w-6 text-text-tertiary" weight="fill" />
          <p className="text-[11px] text-text-tertiary">No workflows yet</p>
        </div>
      }
    />
  )
}

'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FolderKanban, Inbox, Plus, Trash } from 'lucide-react'
import {
  DraggableTreeNav,
  type TreeNavItem,
} from '@/components/layout/draggable-tree-nav'
import { useSubSidebar } from '@/components/layout/sub-sidebar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  deleteSpace,
  renameSpace,
  reorderSpaces,
  updateSpaceMeta,
} from '@/app/(dashboard)/projects/_actions/spaces'
import {
  moveProjectToSpace,
  reorderProjectsInSpace,
  softDeleteProject,
  updateProject,
} from '@/app/(dashboard)/projects/actions'
import { uploadSpaceIcon } from '@/app/(dashboard)/projects/_actions/space-icon'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { NewSpaceButton } from '@/components/projects/new-space-button'

interface ProjectItem extends TreeNavItem {
  color: string | null
}

interface SpaceItem {
  id: string
  name: string
  color: string | null
  icon: string | null
  parent_id: string | null
  position: number
}

interface Props {
  projects: ProjectItem[]
  spaces: SpaceItem[]
  urgentCount?: { overdue: number; dueToday: number }
}

export function ProjectSubNav({ projects, spaces, urgentCount }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()
  const urgentTotal = (urgentCount?.overdue ?? 0) + (urgentCount?.dueToday ?? 0)
  const inboxActive = pathname === '/projects/inbox'

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* My Inbox entry */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <Link
          href="/projects/inbox"
          onClick={onNavigate}
          className={cn(
            'flex items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5',
            'text-[12px] font-medium transition-colors',
            inboxActive
              ? 'bg-bg-tertiary text-text-primary'
              : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
          )}
        >
          <span className="flex items-center gap-2">
            <Inbox className="h-3.5 w-3.5 shrink-0" />
            My Inbox
          </span>
          {urgentTotal > 0 && (
            <Badge
              variant="destructive"
              className="h-4 min-w-4 px-1 text-[10px] font-bold rounded-full leading-none"
            >
              {urgentTotal}
            </Badge>
          )}
        </Link>
      </div>

      {/* Project tree */}
      <div className="flex-1 min-h-0 overflow-hidden">
      <DraggableTreeNav<ProjectItem>
      items={projects}
      folders={spaces}
      itemNoun="project"
      enableFolderIcon
      getHref={(p) => `/projects/${p.id}`}
      renderItemIcon={(p, context) => (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: context?.folderColor ?? p.color ?? 'var(--text-tertiary)' }}
        />
      )}
      onDeleteItem={async (p) => {
        const res = await softDeleteProject(p.id)
        if (!res.ok) {
          toast.error(res.error ?? 'Failed to delete')
          return
        }
        toast.success(`Moved "${p.name}" to trash`)
        router.refresh()
      }}
      actions={{
        reorderFolders: reorderSpaces,
        deleteFolder: deleteSpace,
        renameFolder: renameSpace,
        updateFolderMeta: updateSpaceMeta,
        uploadFolderIcon: uploadSpaceIcon,
        renameItem: async (id, input) => {
          const name = input.name.trim()
          if (!name) return { ok: false, error: 'Project name is required.' }
          await updateProject(id, { name })
          return { ok: true }
        },
        moveItemToFolder: moveProjectToSpace,
        reorderItemsInFolder: reorderProjectsInSpace,
      }}
      toolbar={
        <>
          <NewProjectDialog>
            <Button size="sm" className="h-6 flex-1 text-[11px] gap-1">
              <Plus className="h-3 w-3" />
              Project
            </Button>
          </NewProjectDialog>
          <NewSpaceButton />
        </>
      }
      footer={
        <Link
          href="/projects/trash"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[12px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
        >
          <Trash className="h-3.5 w-3.5" />
          Trash
        </Link>
      }
      emptyState={
        <div className="px-4 py-8 text-center">
          <FolderKanban className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
          <p className="text-[11px] text-text-tertiary">No projects yet</p>
        </div>
      }
    />
      </div>
    </div>
  )
}

'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FolderKanban, Plus, Trash } from 'lucide-react'
import {
  DraggableTreeNav,
  type TreeNavItem,
} from '@/components/layout/draggable-tree-nav'
import { useSubSidebar } from '@/components/layout/sub-sidebar'
import { Button } from '@/components/ui/button'
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
}

export function ProjectSubNav({ projects, spaces }: Props) {
  const router = useRouter()
  const { onNavigate } = useSubSidebar()

  return (
    <DraggableTreeNav<ProjectItem>
      items={projects}
      folders={spaces}
      itemNoun="project"
      enableFolderIcon
      getHref={(p) => `/projects/${p.id}`}
      renderItemIcon={(p) => (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: p.color ?? 'var(--text-tertiary)' }}
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
          <NewSpaceButton className="h-6 w-6 px-0" />
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
  )
}

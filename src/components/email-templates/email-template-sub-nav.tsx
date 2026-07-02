'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Mail } from 'lucide-react'
import {
  DraggableTreeNav,
  type TreeNavItem,
} from '@/components/layout/draggable-tree-nav'
import {
  createFolder,
  deleteFolder,
  renameFolder,
  reorderFolders,
  updateFolderMeta,
  moveTemplateToFolder,
  reorderTemplatesInFolder,
} from '@/app/(dashboard)/email-templates/_actions/folders'
import { deleteTemplate } from '@/app/(dashboard)/email-templates/actions'
import { NewTemplateButton } from '@/components/email-templates/new-template-button'
import { NewFolderButton } from '@/components/workflows/new-folder-button'

// Email templates have no rename / trash / soft-delete of their own — the item
// is hard-deleted via deleteTemplate and the sub-nav omits renameItem. This
// mirrors src/components/workflows/workflow-sub-nav.tsx (minus the workflow
// lifecycle bits) on the generic DraggableTreeNav.

interface EmailTemplateItem extends TreeNavItem {
  // id, name, group_id come from TreeNavItem; the icon is a static Mail glyph.
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
  templates: EmailTemplateItem[]
  folders: FolderItem[]
}

export function EmailTemplateSubNav({ templates, folders }: Props) {
  const router = useRouter()

  return (
    <DraggableTreeNav<EmailTemplateItem>
      items={templates}
      folders={folders}
      itemNoun="template"
      getHref={(t) => `/settings/email-templates/${t.id}`}
      renderItemIcon={(_t, context) => (
        <Mail className="h-3 w-3" style={{ color: context?.folderColor ?? '#6366f1' }} />
      )}
      onDeleteItem={async (t) => {
        const res = await deleteTemplate(t.id)
        if (!res.ok) {
          toast.error(res.error ?? 'Failed to delete')
          return
        }
        toast.success(`Deleted "${t.name}"`)
        router.refresh()
      }}
      deleteItemLabel="Delete"
      enableFolderIcon
      actions={{
        reorderFolders,
        deleteFolder,
        renameFolder,
        updateFolderMeta,
        moveItemToFolder: moveTemplateToFolder,
        reorderItemsInFolder: reorderTemplatesInFolder,
      }}
      toolbar={
        <>
          <NewTemplateButton label="Template" className="h-6 flex-1 text-[11px] gap-1" />
          <NewFolderButton className="h-6 px-3 text-[11px] gap-1" createFolder={createFolder} />
        </>
      }
      emptyState={
        <div className="px-4 py-8 text-center">
          <Mail className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
          <p className="text-[11px] text-text-tertiary">No templates yet</p>
        </div>
      }
    />
  )
}

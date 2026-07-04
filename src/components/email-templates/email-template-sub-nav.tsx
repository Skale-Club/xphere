'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Mail, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DraggableTreeNav,
  type TreeNavItem,
  type TreeNavActions,
} from '@/components/layout/draggable-tree-nav'
import * as tplFolders from '@/app/(dashboard)/email-templates/_actions/folders'
import * as secFolders from '@/app/(dashboard)/email-templates/_actions/section-template-folders'
import {
  deleteTemplate, deleteSectionTemplate, renameSectionTemplate,
} from '@/app/(dashboard)/email-templates/actions'
import { NewTemplateButton } from '@/components/email-templates/new-template-button'
import { NewSectionTemplateButton } from '@/components/email-templates/new-section-template-button'
import { NewFolderButton } from '@/components/workflows/new-folder-button'

interface FolderItem {
  id: string
  name: string
  color: string | null
  icon: string | null
  parent_id: string | null
  position: number
}

interface Props {
  templates: TreeNavItem[]
  templateFolders: FolderItem[]
  sections: TreeNavItem[]
  sectionFolders: FolderItem[]
}

/**
 * Two-tab sub-sidebar: Templates (full emails) and Sections (section
 * templates). Each tab is an independent DraggableTreeNav bound to its own
 * entity's folder tree. The active tab seeds from the URL so deep-linking a
 * section editor opens on the Sections tab.
 */
export function EmailTemplateSubNav({ templates, templateFolders, sections, sectionFolders }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [tab, setTab] = useState<'templates' | 'sections'>(
    pathname.includes('/email-templates/sections/') ? 'sections' : 'templates',
  )

  const templateActions: TreeNavActions = {
    reorderFolders: tplFolders.reorderFolders,
    deleteFolder: tplFolders.deleteFolder,
    renameFolder: tplFolders.renameFolder,
    updateFolderMeta: tplFolders.updateFolderMeta,
    moveItemToFolder: tplFolders.moveTemplateToFolder,
    reorderItemsInFolder: tplFolders.reorderTemplatesInFolder,
  }

  const sectionActions: TreeNavActions = {
    reorderFolders: secFolders.reorderFolders,
    deleteFolder: secFolders.deleteFolder,
    renameFolder: secFolders.renameFolder,
    updateFolderMeta: secFolders.updateFolderMeta,
    moveItemToFolder: secFolders.moveSectionTemplateToFolder,
    reorderItemsInFolder: secFolders.reorderSectionTemplatesInFolder,
    renameItem: (id, input) => renameSectionTemplate(id, input.name),
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-border px-2 py-1.5">
        <TabButton active={tab === 'templates'} onClick={() => setTab('templates')} icon={<Mail className="h-3.5 w-3.5" />}>
          Templates
        </TabButton>
        <TabButton active={tab === 'sections'} onClick={() => setTab('sections')} icon={<Layers className="h-3.5 w-3.5" />}>
          Sections
        </TabButton>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'templates' ? (
          <DraggableTreeNav<TreeNavItem>
            items={templates}
            folders={templateFolders}
            itemNoun="template"
            getHref={(t) => `/settings/email-templates/${t.id}`}
            renderItemIcon={(_t, context) => (
              <Mail className="h-3 w-3" style={{ color: context?.folderColor ?? '#6366f1' }} />
            )}
            onDeleteItem={async (t) => {
              const res = await deleteTemplate(t.id)
              if (!res.ok) { toast.error(res.error ?? 'Failed to delete'); return }
              toast.success(`Deleted "${t.name}"`)
              router.refresh()
            }}
            deleteItemLabel="Delete"
            enableFolderIcon
            actions={templateActions}
            toolbar={
              <>
                <NewTemplateButton label="Template" className="h-6 flex-1 gap-1 text-[11px]" />
                <NewFolderButton className="h-6 gap-1 px-3 text-[11px]" createFolder={tplFolders.createFolder} />
              </>
            }
            emptyState={
              <div className="px-4 py-8 text-center">
                <Mail className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
                <p className="text-[11px] text-text-tertiary">No templates yet</p>
              </div>
            }
          />
        ) : (
          <DraggableTreeNav<TreeNavItem>
            items={sections}
            folders={sectionFolders}
            itemNoun="section"
            getHref={(s) => `/settings/email-templates/sections/${s.id}`}
            renderItemIcon={(_s, context) => (
              <Layers className="h-3 w-3" style={{ color: context?.folderColor ?? '#8b5cf6' }} />
            )}
            onDeleteItem={async (s) => {
              const res = await deleteSectionTemplate(s.id)
              if (!res.ok) { toast.error(res.error ?? 'Failed to delete'); return }
              toast.success(`Deleted "${s.name}"`)
              router.refresh()
            }}
            deleteItemLabel="Delete"
            enableFolderIcon
            actions={sectionActions}
            toolbar={
              <>
                <NewSectionTemplateButton label="Section" className="h-6 flex-1 gap-1 text-[11px]" />
                <NewFolderButton className="h-6 gap-1 px-3 text-[11px]" createFolder={secFolders.createFolder} />
              </>
            }
            emptyState={
              <div className="px-4 py-8 text-center">
                <Layers className="mx-auto mb-2 h-6 w-6 text-text-tertiary" />
                <p className="text-[11px] text-text-tertiary">No section templates yet</p>
                <p className="mt-1 text-[10px] text-text-tertiary">
                  Save a section from a template, or create one here.
                </p>
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}

function TabButton({
  active, onClick, icon, children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

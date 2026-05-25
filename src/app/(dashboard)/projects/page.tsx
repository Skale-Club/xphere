// R08: folder-aware /projects page modeled on /workflows.
// Toolbar: + Project (LEFT) + Folder (LEFT) | Show archived + Trash (RIGHT).
// R01 left placement of the + Project button is preserved.

import Link from 'next/link'
import { Plus, Archive, Trash2, MoreHorizontal } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageContainer } from '@/components/layout/page-header'
import { getProjects } from './actions'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { NewFolderButton } from '@/components/projects/new-folder-button'
import { ProjectsListFolders } from '@/components/projects/projects-list-folders'
import type { ProjectFolderRow } from '@/types/database'

interface PageProps {
  searchParams: Promise<{ archived?: string }>
}

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { archived } = await searchParams
  const includeArchived = archived === '1'

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const [projects, foldersRes, trashCountRes] = await Promise.all([
    getProjects({ includeArchived }),
    db
      .from('project_folders')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .not('deleted_at', 'is', null),
  ])

  const folders = ((foldersRes as { data: ProjectFolderRow[] | null }).data ?? []) as ProjectFolderRow[]
  const trashCount = (trashCountRes as { count: number | null }).count ?? 0

  return (
    <PageContainer className="px-0 py-0 space-y-0">
      <div className="animate-fade-in flex items-center justify-between px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <div className="flex items-center gap-2">
          <NewProjectDialog>
            <Button size="sm" className="h-8 w-8 px-0 sm:w-auto sm:px-3" aria-label="Project">
              <Plus className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Project</span>
            </Button>
          </NewProjectDialog>
          <NewFolderButton />
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <Button
            asChild
            variant={includeArchived ? 'default' : 'ghost'}
            size="sm"
            className="h-8"
          >
            <Link href={includeArchived ? '/projects' : '/projects?archived=1'}>
              <Archive className="h-3.5 w-3.5" />
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="relative h-8">
            <Link href="/projects/trash">
              <Trash2 className="h-3.5 w-3.5" />
              Trash
              {trashCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500/15 text-rose-500 text-[10px] font-semibold">
                  {trashCount}
                </span>
              )}
            </Link>
          </Button>
        </div>

        <div className="lg:hidden">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="h-8 w-8"
                    aria-label="More"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">More</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href={includeArchived ? '/projects' : '/projects?archived=1'}>
                  <Archive className="h-3.5 w-3.5" />
                  {includeArchived ? 'Hide archived' : 'Show archived'}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/projects/trash">
                  <Trash2 className="h-3.5 w-3.5" />
                  Trash
                  {trashCount > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500/15 text-rose-500 text-[10px] font-semibold">
                      {trashCount}
                    </span>
                  )}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-2">
        <ProjectsListFolders projects={projects} folders={folders} />
      </div>
    </PageContainer>
  )
}

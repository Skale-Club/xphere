// /projects has no buffer index | the sub-sidebar owns the list of projects and
// folders. The main area is a prompt: pick a project from the sidebar to open
// it, or — when the org has none yet — an instructive empty state inviting the
// user to create their first one.

import { FolderKanban, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/page-header'
import { getProjects } from './actions'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'

export default async function ProjectsPage() {
  const projects = await getProjects({ includeArchived: false })
  const isEmpty = projects.length === 0

  return (
    <PageContainer>
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-bg-tertiary/70 text-text-tertiary">
          <FolderKanban className="h-6 w-6" />
        </div>
        {isEmpty ? (
          <>
            <h2 className="text-[15px] font-semibold text-text-primary">
              No projects yet
            </h2>
            <p className="mt-1 max-w-sm text-[13px] text-text-tertiary">
              Projects organize your work. Create your first one to get started.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-[15px] font-semibold text-text-primary">
              Select a project
            </h2>
            <p className="mt-1 max-w-sm text-[13px] text-text-tertiary">
              Pick a project from the sidebar to view it, or create a new one.
            </p>
          </>
        )}
        <div className="mt-5">
          <NewProjectDialog>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New project
            </Button>
          </NewProjectDialog>
        </div>
      </div>
    </PageContainer>
  )
}

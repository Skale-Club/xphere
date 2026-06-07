import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { ProjectSubNav } from '@/components/projects/project-sub-nav'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { NewSpaceButton } from '@/components/projects/new-space-button'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { getProjects, getMyUrgentTaskCount } from './actions'
import { listSpaces } from './_actions/spaces'

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const [projects, spacesRes, urgentCount] = await Promise.all([
    getProjects({ includeArchived: false }),
    listSpaces(),
    getMyUrgentTaskCount(),
  ])

  const spaces = spacesRes.ok ? spacesRes.data : []

  const navProjects = projects.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    group_id: p.space_id,
  }))

  const navSpaces = spaces.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    icon: s.icon,
    parent_id: s.parent_id,
    position: s.position,
  }))

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:projects"
      title="Projects"
      nav={<ProjectSubNav projects={navProjects} spaces={navSpaces} urgentCount={urgentCount} />}
      collapsedActions={
        <>
          <NewProjectDialog>
            <Button
              size="icon-sm"
              className="h-7 w-7"
              aria-label="New project"
              title="New project"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </NewProjectDialog>
          <NewSpaceButton iconOnly className="h-7 w-7 p-0" />
        </>
      }
    >
      {children}
    </SubSidebarLayout>
  )
}

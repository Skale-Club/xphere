import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { ProjectSubNav } from '@/components/projects/project-sub-nav'
import { getProjects } from './actions'
import { listSpaces } from './_actions/spaces'

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const [projects, spacesRes] = await Promise.all([
    getProjects({ includeArchived: false }),
    listSpaces(),
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
      autoCollapseBasePath="/projects"
      nav={<ProjectSubNav projects={navProjects} spaces={navSpaces} />}
    >
      {children}
    </SubSidebarLayout>
  )
}

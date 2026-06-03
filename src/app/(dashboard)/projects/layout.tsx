import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { ProjectSubNav } from '@/components/projects/project-sub-nav'
import { getProjects } from './actions'
import { listFolders } from './_actions/folders'

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const [projects, foldersRes] = await Promise.all([
    getProjects({ includeArchived: false }),
    listFolders(),
  ])

  const folders = foldersRes.ok ? foldersRes.data : []

  const navProjects = projects.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    folder_id: p.folder_id,
  }))

  const navFolders = folders.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    icon: f.icon,
    parent_id: f.parent_id,
    position: f.position,
  }))

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:projects"
      title="Projects"
      autoCollapseBasePath="/projects"
      nav={<ProjectSubNav projects={navProjects} folders={navFolders} />}
    >
      {children}
    </SubSidebarLayout>
  )
}

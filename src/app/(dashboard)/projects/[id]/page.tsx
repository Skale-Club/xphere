import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { getProject, getProjectTasks, getProjectLabels, getDefaultSavedView, getProjectCrmContext } from '../actions'
import { listSpaces } from '../_actions/spaces'
import { ProjectDetailClient } from '@/components/projects/project-detail-client'
import { ProjectBoardSkeleton } from '@/components/skeletons/project-board-skeleton'
import type { ProjectRow, ProjectSpaceRow, ProjectViewType } from '@/types/database'

const VALID_VIEWS: ProjectViewType[] = ['board', 'list', 'calendar', 'timeline']

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

function getEffectiveProjectColor(project: ProjectRow, spaces: ProjectSpaceRow[]) {
  const spacesById = new Map(spaces.map((space) => [space.id, space]))
  const seen = new Set<string>()
  let currentId = project.space_id

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const space = spacesById.get(currentId)
    if (!space) break
    if (space.color) return space.color
    currentId = space.parent_id
  }

  return project.color ?? '#6366f1'
}

async function ProjectDetail({ projectId, urlView }: { projectId: string; urlView: string | undefined }) {
  const [project, tasks, labels, crmContext, savedView, spacesRes] = await Promise.all([
    getProject(projectId),
    getProjectTasks(projectId),
    getProjectLabels(projectId),
    getProjectCrmContext(projectId),
    urlView ? null : getDefaultSavedView(projectId),
    listSpaces(),
  ])

  if (!project) notFound()

  const resolved = urlView ?? savedView?.view_type ?? 'board'
  const defaultView = (VALID_VIEWS.includes(resolved as ProjectViewType) ? resolved : 'board') as 'board' | 'list' | 'calendar' | 'timeline'
  const spaces = spacesRes.ok ? spacesRes.data : []
  const effectiveColor = getEffectiveProjectColor(project, spaces)

  return (
    <ProjectDetailClient
      project={project}
      effectiveColor={effectiveColor}
      initialTasks={tasks}
      labels={labels}
      crmContext={crmContext}
      defaultView={defaultView}
    />
  )
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams
  const urlView = sp.view

  return (
    <Suspense fallback={<ProjectBoardSkeleton />}>
      <ProjectDetail projectId={id} urlView={urlView} />
    </Suspense>
  )
}

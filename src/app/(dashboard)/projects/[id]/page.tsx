import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { getProject, getProjectTasks, getProjectLabels, getDefaultSavedView } from '../actions'
import { ProjectDetailClient } from '@/components/projects/project-detail-client'
import { TableSkeleton } from '@/components/skeletons/table-skeleton'
import type { ProjectViewType } from '@/types/database'

const VALID_VIEWS: ProjectViewType[] = ['board', 'list', 'calendar']

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

async function ProjectDetail({ projectId, urlView }: { projectId: string; urlView: string | undefined }) {
  const [project, tasks, labels, savedView] = await Promise.all([
    getProject(projectId),
    getProjectTasks(projectId),
    getProjectLabels(projectId),
    urlView ? null : getDefaultSavedView(projectId),
  ])

  if (!project) notFound()

  const resolved = urlView ?? savedView?.view_type ?? 'board'
  const defaultView = (VALID_VIEWS.includes(resolved as ProjectViewType) ? resolved : 'board') as 'board' | 'list' | 'calendar'

  return (
    <ProjectDetailClient
      project={project}
      initialTasks={tasks}
      labels={labels}
      defaultView={defaultView}
    />
  )
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams
  const urlView = sp.view

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 sm:px-6 lg:px-8 pt-5 pb-1">
        <Link
          href="/projects"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Projects
        </Link>
      </div>
      <Suspense fallback={<TableSkeleton />}>
        <ProjectDetail projectId={id} urlView={urlView} />
      </Suspense>
    </div>
  )
}

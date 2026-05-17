import { Suspense } from 'react'
import Link from 'next/link'
import { TrendingUp, LayoutList, KanbanSquare, Settings } from 'lucide-react'

import {
  getPipelines,
  getStages,
  getOpportunities,
  getDefaultPipeline,
} from './actions'
import { KanbanBoard } from '@/components/pipeline/kanban-board'
import { NewOpportunityDialog } from '@/components/pipeline/new-opportunity-dialog'
import { PipelineSwitcher } from '@/components/pipeline/pipeline-switcher'
import { Button } from '@/components/ui/button'
import { TableSkeleton } from '@/components/skeletons/table-skeleton'

interface PipelinePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const sp = await searchParams
  const requestedPipeline = typeof sp.pipeline === 'string' ? sp.pipeline : undefined
  const assignedTo = typeof sp.assignee === 'string' ? sp.assignee : undefined

  const pipelines = await getPipelines()
  const activePipeline =
    pipelines.find((p) => p.id === requestedPipeline) ??
    (await getDefaultPipeline()) ??
    pipelines[0] ??
    null

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="animate-fade-in flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          <TrendingUp className="h-3.5 w-3.5 text-accent" />
          <span>Sales pipeline</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-text-primary">
              Pipeline
            </h1>
            <p className="mt-1 text-[14px] text-text-secondary">
              Drag deals between stages. Every call, message, and note shows up on each opportunity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PipelineSwitcher pipelines={pipelines} activeId={activePipeline?.id ?? null} />
            <div className="flex items-center rounded-[8px] border border-border-subtle bg-bg-secondary p-0.5">
              <Button asChild variant="ghost" size="sm" className="rounded-[6px] h-7 px-2.5 bg-bg-tertiary">
                <Link href="/pipeline" aria-label="Kanban view">
                  <KanbanSquare className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="rounded-[6px] h-7 px-2.5">
                <Link href="/pipeline/list" aria-label="List view">
                  <LayoutList className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/pipeline/settings">
                <Settings className="h-3.5 w-3.5" /> Settings
              </Link>
            </Button>
            {activePipeline && (
              <NewOpportunityDialog pipelineId={activePipeline.id} />
            )}
          </div>
        </div>
      </div>

      {!activePipeline ? (
        <div className="rounded-[12px] border border-border bg-bg-secondary p-10 text-center">
          <h2 className="text-[15px] font-semibold text-text-primary">No pipelines yet</h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            Create a pipeline to start tracking deals.
          </p>
          <Button asChild className="mt-4">
            <Link href="/pipeline/settings">Create pipeline</Link>
          </Button>
        </div>
      ) : (
        <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
          <KanbanBody pipelineId={activePipeline.id} assignedTo={assignedTo} />
        </Suspense>
      )}
    </div>
  )
}

async function KanbanBody({
  pipelineId,
  assignedTo,
}: {
  pipelineId: string
  assignedTo?: string
}) {
  const [stages, opportunities] = await Promise.all([
    getStages(pipelineId),
    getOpportunities({ pipeline_id: pipelineId, assigned_to: assignedTo }),
  ])

  if (stages.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-10 text-center">
        <h2 className="text-[15px] font-semibold text-text-primary">No stages yet</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Add stages to start dragging opportunities through your funnel.
        </p>
        <Button asChild className="mt-4">
          <Link href="/pipeline/settings">Manage stages</Link>
        </Button>
      </div>
    )
  }

  return (
    <KanbanBoard
      pipelineId={pipelineId}
      stages={stages}
      opportunities={opportunities}
    />
  )
}

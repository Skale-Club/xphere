import { Suspense } from 'react'
import Link from 'next/link'
import { TrendingUp, KanbanSquare, LayoutList, Settings } from 'lucide-react'

import {
  getPipelines,
  getOpportunities,
  getDefaultPipeline,
} from '../actions'
import { NewOpportunityDialog } from '@/components/pipeline/new-opportunity-dialog'
import { PipelineSwitcher } from '@/components/pipeline/pipeline-switcher'
import { OpportunitiesTable } from '@/components/pipeline/opportunities-table'
import { Button } from '@/components/ui/button'
import { TableSkeleton } from '@/components/skeletons/table-skeleton'

interface PipelineListPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PipelineListPage({ searchParams }: PipelineListPageProps) {
  const sp = await searchParams
  const requestedPipeline = typeof sp.pipeline === 'string' ? sp.pipeline : undefined

  const pipelines = await getPipelines()
  const activePipeline =
    pipelines.find((p) => p.id === requestedPipeline) ??
    (await getDefaultPipeline()) ??
    pipelines[0] ??
    null

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="animate-fade-in flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          <TrendingUp className="h-3.5 w-3.5 text-accent" />
          <span>Sales pipeline</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-text-primary">
              All opportunities
            </h1>
            <p className="mt-1 text-[14px] text-text-secondary">
              Table view with sorting and bulk actions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PipelineSwitcher pipelines={pipelines} activeId={activePipeline?.id ?? null} />
            <div className="flex items-center rounded-[8px] border border-border-subtle bg-bg-secondary p-0.5">
              <Button asChild variant="ghost" size="sm" className="rounded-[6px] h-7 px-2.5">
                <Link href="/pipeline" aria-label="Kanban view">
                  <KanbanSquare className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="rounded-[6px] h-7 px-2.5 bg-bg-tertiary">
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
            {activePipeline && <NewOpportunityDialog pipelineId={activePipeline.id} />}
          </div>
        </div>
      </div>

      {!activePipeline ? (
        <div className="rounded-[12px] border border-border bg-bg-secondary p-10 text-center">
          <h2 className="text-[15px] font-semibold text-text-primary">No pipelines yet</h2>
          <Button asChild className="mt-4">
            <Link href="/pipeline/settings">Create pipeline</Link>
          </Button>
        </div>
      ) : (
        <Suspense fallback={<TableSkeleton rows={6} columns={5} />}>
          <ListBody pipelineId={activePipeline.id} />
        </Suspense>
      )}
    </div>
  )
}

async function ListBody({ pipelineId }: { pipelineId: string }) {
  const opportunities = await getOpportunities({ pipeline_id: pipelineId })
  return <OpportunitiesTable opportunities={opportunities} />
}

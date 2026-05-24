import { Suspense } from 'react'
import Link from 'next/link'
import { LayoutList, KanbanSquare, Settings, Plus } from 'lucide-react'

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
import { PipelinePageSkeleton } from '@/components/skeletons/pipeline-page-skeleton'
import { createClient } from '@/lib/supabase/server'

interface PipelinePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default function PipelinePage({ searchParams }: PipelinePageProps) {
  return (
    <Suspense fallback={<PipelinePageSkeleton />}>
      <PipelinePageContent searchParams={searchParams} />
    </Suspense>
  )
}

async function PipelinePageContent({ searchParams }: PipelinePageProps) {
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
    <div className="flex h-full flex-col">
      <div className="animate-fade-in flex flex-row flex-nowrap items-center justify-between gap-1.5 sm:gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <div className="flex items-center gap-2">
          {activePipeline && (
            <NewOpportunityDialog pipelineId={activePipeline.id}>
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Deal</span>
              </Button>
            </NewOpportunityDialog>
          )}
        </div>
        <div className="flex items-center gap-2">
          <PipelineSwitcher pipelines={pipelines} activeId={activePipeline?.id ?? null} />
          <div className="flex items-center h-8 rounded-[8px] border border-border-subtle bg-bg-secondary overflow-hidden">
            <Button asChild variant="ghost" size="sm" className="rounded-none h-8 px-2.5 bg-bg-tertiary">
              <Link href="/pipeline" aria-label="Kanban view">
                <KanbanSquare className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="rounded-none h-8 px-2.5">
              <Link href="/pipeline/list" aria-label="List view">
                <LayoutList className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <Button asChild variant="secondary" size="sm" className="h-8">
            <Link href="/pipeline/settings">
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </Button>
        </div>
      </div>

      {!activePipeline ? (
        <div className="mx-4 sm:mx-6 lg:mx-8 rounded-[12px] border border-border bg-bg-secondary p-10 text-center">
          <h2 className="text-[15px] font-semibold text-text-primary">No pipelines yet</h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            Create a pipeline to start tracking deals.
          </p>
          <Button asChild className="mt-4">
            <Link href="/pipeline/settings">Create pipeline</Link>
          </Button>
        </div>
      ) : (
        <KanbanBody
          pipelineId={activePipeline.id}
          cardFields={(activePipeline.card_fields as string[]) ?? ['contact_name', 'value', 'days_in_stage']}
          assignedTo={assignedTo}
        />
      )}
    </div>
  )
}

async function KanbanBody({
  pipelineId,
  cardFields,
  assignedTo,
}: {
  pipelineId: string
  cardFields: string[]
  assignedTo?: string
}) {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  const orgRow = orgId
    ? (await supabase.from('organizations').select('default_currency').eq('id', orgId as string).single()).data
    : null
  const defaultCurrency = orgRow?.default_currency ?? 'USD'

  const [stages, opportunities] = await Promise.all([
    getStages(pipelineId),
    getOpportunities({ pipeline_id: pipelineId, assigned_to: assignedTo }),
  ])

  if (stages.length === 0) {
    return (
      <div className="mx-4 sm:mx-6 lg:mx-8 rounded-[12px] border border-border bg-bg-secondary p-10 text-center">
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
      cardFields={cardFields}
      defaultCurrency={defaultCurrency}
    />
  )
}

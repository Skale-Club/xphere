import { ScrollText } from 'lucide-react'

import { getLogs, getWorkflowOptions } from './actions'
import { LogsTable } from '@/components/tools/logs-table'
import { LogsFilters } from '@/components/tools/logs-filters'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import type { LogStatus } from './actions'

const BASE_PATH = '/workflows/logs'

function buildPageUrl(
  page: number,
  params: { status?: string; workflow?: string; from?: string; to?: string; q?: string }
): string {
  const p = new URLSearchParams()
  if (params.status && params.status !== 'all') p.set('status', params.status)
  if (params.workflow) p.set('workflow', params.workflow)
  if (params.from) p.set('from', params.from)
  if (params.to) p.set('to', params.to)
  if (params.q) p.set('q', params.q)
  p.set('page', String(page))
  return `${BASE_PATH}?${p.toString()}`
}

export default async function ToolLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page ?? '1') || 1)
  const status = params.status as string | undefined
  const workflowId = (params.workflow ?? params.tool) as string | undefined
  const from = params.from as string | undefined
  const to = params.to as string | undefined
  const q = params.q as string | undefined

  const [{ logs, total, pageCount }, workflowOptions] = await Promise.all([
    getLogs({
      status: status as LogStatus | 'all' | undefined,
      workflowId,
      from,
      to,
      q,
      page,
    }),
    getWorkflowOptions(),
  ])

  const filterParams = { status, workflow: workflowId, from, to, q }
  const prevHref = page > 1 ? buildPageUrl(page - 1, filterParams) : null
  const nextHref = page < pageCount ? buildPageUrl(page + 1, filterParams) : null

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Action engine"
        eyebrowIcon={ScrollText}
        title="Execution logs"
        description={
          <>
            All workflow executions across your assistants.
            {total > 0 && (
              <>
                {' '}
                <span className="tabular text-text-primary">{total}</span> total.
              </>
            )}
          </>
        }
      />

      <LogsFilters
        workflowOptions={workflowOptions}
        showWorkflowFilter
        basePath={BASE_PATH}
        status={status}
        workflow={workflowId}
        from={from}
        to={to}
        q={q}
      />

      <LogsTable
        logs={logs}
        total={total}
        page={page}
        pageCount={pageCount}
        showWorkflowColumn
        prevHref={prevHref}
        nextHref={nextHref}
      />
    </PageContainer>
  )
}

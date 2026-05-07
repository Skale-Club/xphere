import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getLogs, getLogStats } from '@/app/(dashboard)/tools/logs/actions'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LogsTable } from '@/components/tools/logs-table'
import { LogsFilters } from '@/components/tools/logs-filters'
import { InlineToolName } from '@/components/tools/inline-tool-name'
import type { LogStatus } from '@/app/(dashboard)/tools/logs/actions'

type ToolConfigRow = Database['public']['Tables']['tool_configs']['Row']

type ToolConfigDetail = ToolConfigRow & {
  integrations: {
    id: string
    name: string
    provider: string
  } | null
}

const ACTION_TYPE_LABELS: Record<ToolConfigRow['action_type'], string> = {
  create_contact: 'Create Contact',
  get_availability: 'Check Availability',
  create_appointment: 'Book Appointment',
  send_sms: 'Send SMS',
  knowledge_base: 'Knowledge Base',
  custom_webhook: 'Custom Webhook',
  manychat_set_field: 'ManyChat: Set Field',
  manychat_add_tag: 'ManyChat: Add Tag',
  manychat_trigger_flow: 'ManyChat: Trigger Flow',
  manychat_send_message: 'ManyChat: Send Message',
}

function buildPageUrl(
  toolConfigId: string,
  page: number,
  params: { status?: string; from?: string; to?: string; q?: string }
): string {
  const p = new URLSearchParams()
  if (params.status && params.status !== 'all') p.set('status', params.status)
  if (params.from) p.set('from', params.from)
  if (params.to) p.set('to', params.to)
  if (params.q) p.set('q', params.q)
  p.set('page', String(page))
  return `/tools/${toolConfigId}?${p.toString()}`
}

export default async function ToolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ toolConfigId: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { toolConfigId } = await params
  const sp = await searchParams

  const page = Math.max(1, Number(sp.page ?? '1') || 1)
  const status = sp.status as string | undefined
  const from = sp.from as string | undefined
  const to = sp.to as string | undefined
  const q = sp.q as string | undefined

  const supabase = await createClient()

  const { data: toolConfig, error: toolError } = await supabase
    .from('tool_configs')
    .select('*, integrations(id, name, provider)')
    .eq('id', toolConfigId)
    .single()

  if (toolError || !toolConfig) notFound()

  const typedToolConfig = toolConfig as ToolConfigDetail
  const basePath = `/tools/${toolConfigId}`

  const [{ logs, total, pageCount }, stats] = await Promise.all([
    getLogs({
      toolConfigId,
      status: status as LogStatus | 'all' | undefined,
      from,
      to,
      q,
      page,
    }),
    getLogStats(toolConfigId),
  ])

  const filterParams = { status, from, to, q }
  const prevHref = page > 1 ? buildPageUrl(toolConfigId, page - 1, filterParams) : null
  const nextHref = page < pageCount ? buildPageUrl(toolConfigId, page + 1, filterParams) : null

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <Link
        href="/tools"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Tools
      </Link>

      <div className="space-y-1">
        <InlineToolName toolConfigId={toolConfigId} initialName={typedToolConfig.tool_name} />
        <p className="text-sm text-muted-foreground">
          View this tool configuration and its execution logs.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configuration</CardTitle>
          <CardDescription>
            This is the platform mapping used when Vapi calls this tool name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Tool Name</dt>
              <dd className="font-mono break-all">{typedToolConfig.tool_name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Action Type</dt>
              <dd>{ACTION_TYPE_LABELS[typedToolConfig.action_type]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Integration</dt>
              <dd>{typedToolConfig.integrations?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Provider</dt>
              <dd>{typedToolConfig.integrations?.provider ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge
                  variant="outline"
                  className={
                    typedToolConfig.is_active
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-zinc-500/15 text-zinc-400'
                  }
                >
                  {typedToolConfig.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{format(new Date(typedToolConfig.created_at), 'MMM d, yyyy HH:mm')}</dd>
            </div>
          </dl>

          <div className="mt-4 border-t pt-4">
            <p className="text-xs text-muted-foreground mb-1">Fallback Message</p>
            <p className="text-sm">{typedToolConfig.fallback_message}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Runs</CardDescription>
            <CardTitle className="text-2xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Successes</CardDescription>
            <CardTitle className="text-2xl">{stats.successCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Average Execution</CardDescription>
            <CardTitle className="text-2xl">
              {stats.averageMs != null ? `${stats.averageMs}ms` : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Execution Logs</h2>
        <LogsFilters
          toolOptions={[]}
          showToolFilter={false}
          basePath={basePath}
          status={status}
          from={from}
          to={to}
          q={q}
        />
        <LogsTable
          logs={logs}
          total={total}
          page={page}
          pageCount={pageCount}
          showToolColumn={false}
          prevHref={prevHref}
          nextHref={nextHref}
        />
      </div>
    </div>
  )
}

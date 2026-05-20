import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, Power, Workflow } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'

import { getToolConfigs, getFolders } from './actions'
import { getIntegrations } from '@/app/(dashboard)/integrations/actions'
import { listWorkflows } from './flows/_actions/workflows'
import { ToolsTable } from '@/components/tools/tools-table'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const tab = sp.tab === 'flows' ? 'flows' : 'automations'

  const [toolConfigs, integrations, folders, flowsResult] = await Promise.all([
    getToolConfigs(),
    getIntegrations(),
    getFolders(),
    listWorkflows(),
  ])

  const flows = flowsResult.ok ? flowsResult.data : []

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Build"
        eyebrowIcon={Workflow}
        title="Workflows"
        description="Action tools and visual flows — configure triggers, conditions, and multi-step automations."
      />

      <Tabs defaultValue={tab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="automations" asChild>
            <Link href="/workflows?tab=automations">Action Tools</Link>
          </TabsTrigger>
          <TabsTrigger value="flows" asChild>
            <Link href="/workflows?tab=flows">Visual Flows</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="automations">
          <ToolsTable toolConfigs={toolConfigs} integrations={integrations} folders={folders} />
        </TabsContent>

        <TabsContent value="flows">
          {/* Header with New flow button */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Multi-step workflows triggered by events, schedules, or manual runs.
            </p>
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/workflows/flows/new">
                <Plus className="h-3.5 w-3.5" /> New flow
              </Link>
            </Button>
          </div>

          {flows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <Workflow className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium mb-1">No flows yet</p>
              <p className="text-sm text-muted-foreground mb-4">
                Build your first multi-step automation visually.
              </p>
              <Button asChild size="sm" className="gap-1.5">
                <Link href="/workflows/flows/new">
                  <Plus className="h-3.5 w-3.5" /> Create your first flow
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {flows.map((flow) => (
                <Link
                  key={flow.id}
                  href={`/workflows/flows/${flow.id}`}
                  className="group rounded-lg border border-border bg-card hover:border-border/80 transition-colors p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate group-hover:underline">{flow.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                        {flow.slug}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[10px] shrink-0 gap-1',
                        flow.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400',
                      )}
                    >
                      <Power className="h-2.5 w-2.5" />
                      {flow.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  {flow.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{flow.description}</p>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    Updated {formatDistanceToNow(parseISO(flow.updated_at), { addSuffix: true })}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}

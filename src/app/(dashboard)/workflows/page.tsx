// SEED-025 Phase E: unified workflows page. No more tabs separating
// "Action Tools" and "Visual Flows" | everything is a Workflow with a
// kind/trigger badge, surfaced in one list.
//
// SEED-038: adds folders, archive toggle (?archived=1), and trash entry.

import Link from 'next/link'
import { Workflow, ScrollText, Trash2, Archive } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { listUnifiedWorkflows } from '@/lib/workflows/list'
import { WorkflowsList } from '@/components/workflows/workflows-list'
import { NewFolderButton } from '@/components/workflows/new-folder-button'
import { NewWorkflowButton } from '@/components/flows/new-workflow-button'
import type { Database } from '@/types/database'

type WorkflowFolderRow = Database['public']['Tables']['workflow_folders']['Row']

interface PageProps {
  searchParams: Promise<{ archived?: string }>
}

export default async function WorkflowsPage({ searchParams }: PageProps) {
  const { archived } = await searchParams
  const includeArchived = archived === '1'

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  const [workflows, foldersRes, trashCountRes] = await Promise.all([
    orgId
      ? listUnifiedWorkflows(orgId as string, supabase, { includeArchived })
      : Promise.resolve([]),
    orgId
      ? supabase
          .from('workflow_folders')
          .select('*')
          .order('position', { ascending: true })
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as WorkflowFolderRow[] }),
    orgId
      ? supabase
          .from('workflows')
          .select('id', { count: 'exact', head: true })
          .not('deleted_at', 'is', null)
      : Promise.resolve({ count: 0 }),
  ])

  const folders = ((foldersRes as { data: WorkflowFolderRow[] | null }).data ?? []) as WorkflowFolderRow[]
  const trashCount = (trashCountRes as { count: number | null }).count ?? 0

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Build"
        eyebrowIcon={Workflow}
        title="Workflows"
        description="Tools and flows in one place. Triggered by events, schedules, agents, or webhooks."
      />

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">
          {workflows.length === 0
            ? 'No workflows yet.'
            : `${workflows.length} workflow${workflows.length !== 1 ? 's' : ''}${includeArchived ? ' (including archived)' : ''}`}
        </p>
        <div className="flex items-center gap-2">
          <Button asChild variant={includeArchived ? 'default' : 'ghost'} size="sm">
            <Link href={includeArchived ? '/workflows' : '/workflows?archived=1'}>
              <Archive className="h-3.5 w-3.5" />
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="relative">
            <Link href="/workflows/trash">
              <Trash2 className="h-3.5 w-3.5" />
              Trash
              {trashCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500/15 text-rose-500 text-[10px] font-semibold">
                  {trashCount}
                </span>
              )}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/workflows/logs">
              <ScrollText className="h-3.5 w-3.5" /> Logs
            </Link>
          </Button>
          <NewFolderButton />
          <NewWorkflowButton />
        </div>
      </div>

      <WorkflowsList workflows={workflows} folders={folders} />
    </PageContainer>
  )
}

import { createClient } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { WorkflowSubNav } from '@/components/workflows/workflow-sub-nav'
import { NewWorkflowButton } from '@/components/flows/new-workflow-button'
import { NewFolderButton } from '@/components/workflows/new-folder-button'
import { listUnifiedWorkflows } from '@/lib/workflows/list'
import type { Database } from '@/types/database'

type WorkflowFolderRow = Database['public']['Tables']['folders']['Row']

export default async function WorkflowsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  const [workflows, foldersRes] = await Promise.all([
    orgId
      ? listUnifiedWorkflows(orgId as string, supabase, { includeArchived: false })
      : Promise.resolve([]),
    orgId
      ? supabase
          .from('folders')
          .select('*')
          .eq('entity_type', 'workflow')
          .order('position', { ascending: true })
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as WorkflowFolderRow[] }),
  ])

  const folders = (
    (foldersRes as { data: WorkflowFolderRow[] | null }).data ?? []
  ) as WorkflowFolderRow[]

  const navWorkflows = workflows.map((w) => ({
    id: w.id,
    name: w.name,
    kind: w.kind,
    trigger_type: w.trigger_type,
    group_id: w.folder_id,
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
      storageKey="sub-sidebar:workflows"
      title="Workflows"
      nav={<WorkflowSubNav workflows={navWorkflows} folders={navFolders} />}
      collapsedActions={
        <>
          <NewWorkflowButton
            label="New workflow"
            iconOnly
            className="h-7 w-7 p-0"
          />
          <NewFolderButton iconOnly className="h-7 w-7 p-0" />
        </>
      }
    >
      {children}
    </SubSidebarLayout>
  )
}

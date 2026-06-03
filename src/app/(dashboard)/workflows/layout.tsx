import { createClient } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { WorkflowSubNav } from '@/components/workflows/workflow-sub-nav'
import { listUnifiedWorkflows } from '@/lib/workflows/list'
import type { Database } from '@/types/database'

type WorkflowFolderRow = Database['public']['Tables']['workflow_folders']['Row']

export default async function WorkflowsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  const [workflows, foldersRes] = await Promise.all([
    orgId
      ? listUnifiedWorkflows(orgId as string, supabase, { includeArchived: false })
      : Promise.resolve([]),
    orgId
      ? supabase
          .from('workflow_folders')
          .select('*')
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
    folder_id: w.folder_id,
  }))

  const navFolders = folders.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    parent_id: f.parent_id,
    position: f.position,
  }))

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:workflows"
      title="Workflows"
      autoCollapseBasePath="/workflows"
      nav={<WorkflowSubNav workflows={navWorkflows} folders={navFolders} />}
    >
      {children}
    </SubSidebarLayout>
  )
}

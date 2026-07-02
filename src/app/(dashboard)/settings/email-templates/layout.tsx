import { createClient } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { EmailTemplateSubNav } from '@/components/email-templates/email-template-sub-nav'
import { NewTemplateButton } from '@/components/email-templates/new-template-button'
import { NewFolderButton } from '@/components/workflows/new-folder-button'
import { createFolder } from '@/app/(dashboard)/email-templates/_actions/folders'
import { listTemplates } from '@/app/(dashboard)/email-templates/actions'
import type { Database } from '@/types/database'

type EmailFolderRow = Database['public']['Tables']['folders']['Row']

export default async function EmailTemplatesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  const [templatesRes, foldersRes] = await Promise.all([
    listTemplates(),
    orgId
      ? supabase
          .from('folders')
          .select('*')
          .eq('entity_type', 'email_template')
          .order('position', { ascending: true })
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as EmailFolderRow[] }),
  ])

  const templates = templatesRes.ok ? templatesRes.data : []
  const folders = ((foldersRes as { data: EmailFolderRow[] | null }).data ?? []) as EmailFolderRow[]

  const navTemplates = templates.map((t) => ({
    id: t.id,
    name: t.name,
    group_id: t.folder_id,
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
      storageKey="sub-sidebar:email-templates"
      title="Email Templates"
      nav={<EmailTemplateSubNav templates={navTemplates} folders={navFolders} />}
      collapsedActions={
        <>
          <NewTemplateButton label="New template" iconOnly className="h-7 w-7 p-0" />
          <NewFolderButton iconOnly className="h-7 w-7 p-0" createFolder={createFolder} />
        </>
      }
    >
      {children}
    </SubSidebarLayout>
  )
}

import { createClient } from '@/lib/supabase/server'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { EmailTemplateSubNav } from '@/components/email-templates/email-template-sub-nav'
import { NewTemplateButton } from '@/components/email-templates/new-template-button'
import { NewSectionTemplateButton } from '@/components/email-templates/new-section-template-button'
import { NewFolderButton } from '@/components/workflows/new-folder-button'
import { createFolder } from '@/app/(dashboard)/email-templates/_actions/folders'
import { createFolder as createSectionFolder } from '@/app/(dashboard)/email-templates/_actions/section-template-folders'
import { listTemplates, listSectionTemplates } from '@/app/(dashboard)/email-templates/actions'
import type { Database } from '@/types/database'

type EmailFolderRow = Database['public']['Tables']['folders']['Row']

function foldersQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityType: string,
  orgId: string | null,
) {
  return orgId
    ? supabase
        .from('folders')
        .select('*')
        .eq('entity_type', entityType)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
    : Promise.resolve({ data: [] as EmailFolderRow[] })
}

export default async function EmailTemplatesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  const [templatesRes, tplFoldersRes, sectionsRes, secFoldersRes] = await Promise.all([
    listTemplates(),
    foldersQuery(supabase, 'email_template', orgId as string | null),
    listSectionTemplates(),
    foldersQuery(supabase, 'email_section_template', orgId as string | null),
  ])

  const templates = templatesRes.ok ? templatesRes.data : []
  const sections = sectionsRes.ok ? sectionsRes.data : []
  const tplFolders = ((tplFoldersRes as { data: EmailFolderRow[] | null }).data ?? []) as EmailFolderRow[]
  const secFolders = ((secFoldersRes as { data: EmailFolderRow[] | null }).data ?? []) as EmailFolderRow[]

  const toNavFolder = (f: EmailFolderRow) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    icon: f.icon,
    parent_id: f.parent_id,
    position: f.position,
  })

  return (
    <SubSidebarLayout
      storageKey="sub-sidebar:email-templates"
      title="Email Templates"
      nav={
        <EmailTemplateSubNav
          templates={templates.map((t) => ({ id: t.id, name: t.name, group_id: t.folder_id }))}
          templateFolders={tplFolders.map(toNavFolder)}
          sections={sections.map((s) => ({ id: s.id, name: s.name, group_id: s.folder_id }))}
          sectionFolders={secFolders.map(toNavFolder)}
        />
      }
      collapsedActions={
        // Four distinct actions mirroring the expanded panel's two tabs
        // (Templates / Sections), each with its own toolbar: New template +
        // New template folder, then New section + New section folder. Phase
        // 7: this used to be two visually-identical bare-Plus buttons (New
        // template vs New section were indistinguishable) plus a single
        // folder button that only ever created TEMPLATE folders — the
        // section-folder action had no rail affordance at all.
        <>
          <NewTemplateButton label="New template" iconOnly iconVariant="mail" className="h-7 w-7 p-0" />
          <NewFolderButton
            label="New template folder"
            iconOnly
            className="h-7 w-7 p-0"
            createFolder={createFolder}
          />
          <div className="my-0.5 h-px w-6 shrink-0 bg-border-subtle" aria-hidden="true" />
          <NewSectionTemplateButton label="New section" iconOnly iconVariant="layers" className="h-7 w-7 p-0" />
          <NewFolderButton
            label="New section folder"
            iconOnly
            className="h-7 w-7 p-0 text-violet-400 hover:border-violet-400/60 hover:text-violet-300"
            createFolder={createSectionFolder}
          />
        </>
      }
    >
      {children}
    </SubSidebarLayout>
  )
}

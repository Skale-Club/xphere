import { redirect, notFound } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getTemplate, listSectionTemplates } from '@/app/(dashboard)/email-templates/actions'
import { EmailTemplateEditor } from '@/app/(dashboard)/email-templates/_components/email-template-editor'

export default async function SettingsEmailTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { id } = await params
  const [templateResult, sectionsResult] = await Promise.all([
    getTemplate(id),
    listSectionTemplates(),
  ])

  if (!templateResult.ok) notFound()

  const template = templateResult.data
  const sectionTemplates = sectionsResult.ok ? sectionsResult.data : []

  return (
    <div className="flex flex-col h-full">
      <EmailTemplateEditor template={template} sectionTemplates={sectionTemplates} />
    </div>
  )
}

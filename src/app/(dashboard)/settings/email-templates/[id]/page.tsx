import { redirect, notFound } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getTemplate, getReusableBlocks } from '@/app/(dashboard)/email-templates/actions'
import { EmailTemplateEditor } from '@/app/(dashboard)/email-templates/_components/email-template-editor'

export default async function SettingsEmailTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { id } = await params
  const [templateResult, blocksResult] = await Promise.all([
    getTemplate(id),
    getReusableBlocks(),
  ])

  if (!templateResult.ok) notFound()

  const template = templateResult.data
  const reusableBlocks = blocksResult.ok ? blocksResult.data : []

  return (
    <div className="flex flex-col h-full">
      <EmailTemplateEditor template={template} reusableBlocks={reusableBlocks} />
    </div>
  )
}

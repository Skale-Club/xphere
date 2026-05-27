import { redirect, notFound } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getTemplate, getReusableBlocks } from '../actions'
import { EmailTemplateEditor } from '../_components/email-template-editor'

export default async function EmailTemplateEditorPage({
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

  // The template name is rendered as an inline-editable node inside the
  // global breadcrumb (see EmailTemplateEditor → useBreadcrumbOverride),
  // so we no longer need a second page-level header row here.
  return (
    <div className="flex flex-col h-full">
      <EmailTemplateEditor template={template} reusableBlocks={reusableBlocks} />
    </div>
  )
}

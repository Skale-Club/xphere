import { redirect, notFound } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getMessageTemplate } from '../_actions/message-templates'
import { MessageTemplateEditor } from '../_components/message-template-editor'

export default async function MessageTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { id } = await params
  const result = await getMessageTemplate(id)
  if (!result.ok) notFound()

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8">
      <MessageTemplateEditor template={result.data} />
    </div>
  )
}

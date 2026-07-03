import { redirect, notFound } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getReusableBlock } from '@/app/(dashboard)/email-templates/actions'
import { SectionTemplateEditor } from '@/app/(dashboard)/email-templates/_components/section-template-editor'

export default async function SectionTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { id } = await params
  const result = await getReusableBlock(id)
  if (!result.ok) notFound()

  return (
    <div className="flex h-full flex-col">
      <SectionTemplateEditor block={result.data} />
    </div>
  )
}

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card shrink-0">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link href="/email-templates">
            <ArrowLeft className="h-3.5 w-3.5" /> Templates
          </Link>
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-medium truncate flex-1">{template.name}</span>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <EmailTemplateEditor template={template} reusableBlocks={reusableBlocks} />
      </div>
    </div>
  )
}

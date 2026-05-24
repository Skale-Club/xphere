import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { getEmailTemplate } from '../../_actions/templates'
import { renderEmailHtml } from '@/lib/email-marketing/render'
import { EmailPreview } from '@/components/email-marketing/email-preview'

export default async function EmailPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { id } = await params
  const result = await getEmailTemplate(id)
  if (!result.ok) notFound()

  const { sections, ...template } = result.data
  const html = renderEmailHtml(template, sections)

  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background shrink-0">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/email-marketing/${id}`}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Editar
          </Link>
        </Button>
        <span className="text-sm font-medium">{template.name}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <EmailPreview
          html={html}
          subjectLine={template.subject_line}
          previewText={template.preview_text}
        />
      </div>
    </div>
  )
}

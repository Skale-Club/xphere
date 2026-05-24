import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getUser } from '@/lib/supabase/server'
import { getEmailTemplate } from '../_actions/templates'
import { TemplateEditor } from '@/components/email-marketing/template-editor'
import { cn } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/15 text-yellow-400',
  ready: 'bg-emerald-500/15 text-emerald-400',
  archived: 'bg-zinc-500/15 text-zinc-400',
}

export default async function EmailTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { id } = await params
  const result = await getEmailTemplate(id)
  if (!result.ok) notFound()

  const template = result.data

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/email-marketing">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Templates
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href={`/email-marketing/${id}/preview`} target="_blank">
            <Eye className="h-3.5 w-3.5" /> Preview completo
          </Link>
        </Button>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-semibold">{template.name}</h1>
          <Badge
            variant="secondary"
            className={cn('text-[11px] capitalize', STATUS_COLORS[template.status] ?? '')}
          >
            {template.status}
          </Badge>
        </div>
        {template.ai_prompt && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            <span className="font-medium">Prompt:</span> {template.ai_prompt}
          </p>
        )}
      </div>

      <TemplateEditor template={template} />
    </div>
  )
}

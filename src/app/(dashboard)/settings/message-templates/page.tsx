import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessagesSquare, Plus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { listMessageTemplates } from './_actions/message-templates'
import { MessageTemplateListActions } from './_components/message-template-list-actions'

export default async function MessageTemplatesPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const result = await listMessageTemplates()
  const templates = result.ok ? result.data : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Messages</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Free-form quick-reply templates for SMS, Email, and WhatsApp — no approval needed.
          </p>
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/settings/message-templates/new">
            <Plus className="h-3.5 w-3.5" /> New Template
          </Link>
        </Button>
      </div>

      {templates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium mb-1">No templates yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first Messages template with a default body and optional channel overrides.
          </p>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/settings/message-templates/new">
              <Plus className="h-3.5 w-3.5" /> New Template
            </Link>
          </Button>
        </div>
      )}

      {templates.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
              <Link href={`/settings/message-templates/${template.id}`} className="text-sm font-medium hover:underline line-clamp-1">
                {template.name}
              </Link>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {template.body.slice(0, 80) || 'No default body yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                Updated {formatDistanceToNow(new Date(template.updated_at), { addSuffix: true })}
              </p>
              <div className="flex items-center gap-1 mt-auto pt-1">
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                  <Link href={`/settings/message-templates/${template.id}`}>Edit</Link>
                </Button>
                <MessageTemplateListActions templateId={template.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

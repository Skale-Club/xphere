import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Mail, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getUser } from '@/lib/supabase/server'
import { listTemplates } from '@/app/(dashboard)/email-templates/actions'
import { TemplateListActions } from '@/app/(dashboard)/email-templates/_components/template-list-actions'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

const STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-yellow-500/15 text-yellow-400',
  published: 'bg-emerald-500/15 text-emerald-400',
  archived: 'bg-zinc-500/15 text-zinc-400',
}

// Defensive: legacy rows may still carry 'ready' before migration 1229 runs.
function displayStatus(status: string): string {
  return status === 'ready' ? 'published' : status
}

export default async function SettingsEmailTemplatesPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const result = await listTemplates()
  const templates = result.ok ? result.data : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Email Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Build and manage reusable email templates for your campaigns.
          </p>
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/settings/email-templates/new">
            <Plus className="h-3.5 w-3.5" /> New Template
          </Link>
        </Button>
      </div>

      {/* Stats bar */}
      {templates.length > 0 && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{templates.length} template{templates.length !== 1 ? 's' : ''}</span>
          <span className="text-yellow-400">
            {templates.filter((t) => t.status === 'draft').length} draft{templates.filter((t) => t.status === 'draft').length !== 1 ? 's' : ''}
          </span>
          <span className="text-emerald-400">
            {templates.filter((t) => t.status === 'published').length} published
          </span>
        </div>
      )}

      {/* Empty state */}
      {templates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <Mail className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium mb-1">No templates yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first email template with the block editor.
          </p>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/settings/email-templates/new">
              <Plus className="h-3.5 w-3.5" /> New Template
            </Link>
          </Button>
        </div>
      )}

      {/* Template grid */}
      {templates.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className="rounded-lg border border-border bg-card hover:border-border/80 transition-colors flex flex-col"
            >
              {/* Preview area */}
              <Link
                href={`/settings/email-templates/${template.id}`}
                className="block h-36 rounded-t-lg bg-muted/30 overflow-hidden border-b border-border"
              >
                {template.html_snapshot ? (
                  <div className="w-full h-full pointer-events-none overflow-hidden">
                    <div
                      className="origin-top-left scale-[0.2] w-[500%] h-[500%]"
                      dangerouslySetInnerHTML={{ __html: template.html_snapshot }}
                    />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Mail className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                )}
              </Link>

              {/* Card footer */}
              <div className="p-3 flex flex-col gap-2 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/settings/email-templates/${template.id}`}
                    className="text-sm font-medium leading-tight hover:underline line-clamp-2 flex-1"
                  >
                    {template.name}
                  </Link>
                  <Badge
                    variant="secondary"
                    className={cn('text-[10px] capitalize shrink-0', STATUS_CLASSES[displayStatus(template.status)] ?? '')}
                  >
                    {displayStatus(template.status)}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">
                  Updated {formatDistanceToNow(new Date(template.updated_at), { addSuffix: true })}
                </p>

                <TemplateListActions templateId={template.id} status={displayStatus(template.status)} basePath="/settings/email-templates" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

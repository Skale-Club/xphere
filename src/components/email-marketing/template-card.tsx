'use client'

// @deprecated Legacy /email-marketing system, retired in favor of the
// block-based builder at /settings/email-templates. Kept for existing
// data only — do not build new features against this. See
// .planning/workstreams/email-builder-hardening/PLAN.md Phase 5.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { MoreHorizontal, Eye, Pencil, Trash2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { deleteEmailTemplate } from '@/app/(dashboard)/email-marketing/_actions/templates'
import type { EmailTemplateRow } from '@/app/(dashboard)/email-marketing/_actions/templates'
import { cn } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/15 text-yellow-400',
  ready: 'bg-emerald-500/15 text-emerald-400',
  archived: 'bg-zinc-500/15 text-zinc-400',
}

interface TemplateCardProps {
  template: EmailTemplateRow
}

export function TemplateCard({ template }: TemplateCardProps) {
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm(`Deletar "${template.name}"? Essa ação não pode ser desfeita.`)) return
    startTransition(async () => {
      const result = await deleteEmailTemplate(template.id)
      if (!result.ok) toast.error(result.error)
      else toast.success('Template deletado')
    })
  }

  return (
    <div className="group rounded-lg border border-border bg-card hover:border-border/80 transition-colors flex flex-col">
      {/* Color strip based on status */}
      <div
        className={cn(
          'h-1 rounded-t-lg',
          template.status === 'ready' && 'bg-emerald-500',
          template.status === 'draft' && 'bg-yellow-500',
          template.status === 'archived' && 'bg-zinc-500',
        )}
      />

      <div className="p-4 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/email-marketing/${template.id}`}
              className="text-sm font-medium hover:underline line-clamp-1"
            >
              {template.name}
            </Link>
            {template.subject_line && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {template.subject_line}
              </p>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/email-marketing/${template.id}/preview`}>
                  <Eye className="h-3.5 w-3.5 mr-2" /> Preview
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/email-marketing/${template.id}`}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleDelete}
                disabled={isPending}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Deletar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {template.preview_text && (
          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
            {template.preview_text}
          </p>
        )}

        {template.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {template.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
        <Badge
          variant="secondary"
          className={cn('text-[10px] capitalize', STATUS_COLORS[template.status] ?? '')}
        >
          {template.status}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {format(parseISO(template.created_at), 'dd MMM yyyy')}
        </span>
      </div>
    </div>
  )
}

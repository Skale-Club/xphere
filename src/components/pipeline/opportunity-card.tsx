'use client'

import * as React from 'react'
import Link from 'next/link'
import { MoreHorizontal, Trophy, Frown, Trash2, Pencil } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  formatCurrency,
  daysSince,
  ageTone,
  initialsOf,
} from '@/lib/pipeline/format'
import type { OpportunityWithContact } from '@/app/(dashboard)/pipeline/actions'

interface OpportunityCardProps {
  opportunity: OpportunityWithContact
  onAction: (action: 'edit' | 'won' | 'lost' | 'delete', id: string) => void
  isDragging?: boolean
  isOverlay?: boolean
}

const TONE_PILL: Record<'neutral' | 'warning' | 'danger', string> = {
  neutral: 'bg-bg-tertiary text-text-tertiary ring-1 ring-border-subtle',
  warning: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',
  danger: 'bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20',
}

export function OpportunityCard({
  opportunity,
  onAction,
  isOverlay = false,
}: OpportunityCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: opportunity.id,
    data: { type: 'opportunity', stageId: opportunity.stage_id },
  })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging && !isOverlay ? 0.35 : 1,
  }

  const days = daysSince(opportunity.updated_at)
  const tone = ageTone(days)
  const contactName = opportunity.contact?.name ?? opportunity.contact?.phone ?? 'Unassigned'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group relative cursor-grab active:cursor-grabbing rounded-[10px] border border-border-subtle bg-bg-secondary px-3 py-2.5 shadow-elevation-sm transition-all',
        'hover:border-border-strong hover:shadow-elevation-md hover:-translate-y-[1px]',
        isOverlay && 'rotate-[1.5deg] scale-[1.03] shadow-elevation-lg ring-2 ring-accent/40 cursor-grabbing',
      )}
    >
      <div className="flex items-start gap-2.5">
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarFallback className="text-[10px] font-semibold bg-accent-muted text-accent">
            {initialsOf(contactName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1">
            <Link
              href={`/pipeline/${opportunity.id}`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-[12.5px] font-medium text-text-primary leading-tight truncate hover:underline"
            >
              {opportunity.title}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  className="opacity-0 group-hover:opacity-100 transition-opacity rounded-[6px] p-0.5 hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary"
                  aria-label="Opportunity actions"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => onAction('edit', opportunity.id)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('won', opportunity.id)}>
                  <Trophy className="h-3.5 w-3.5 mr-2 text-emerald-400" /> Mark won
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAction('lost', opportunity.id)}>
                  <Frown className="h-3.5 w-3.5 mr-2 text-rose-400" /> Mark lost
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onAction('delete', opportunity.id)}
                  className="text-rose-400 focus:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mt-0.5 text-[11.5px] text-text-tertiary truncate">{contactName}</div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold tabular-nums text-text-primary">
          {formatCurrency(Number(opportunity.value), opportunity.currency)}
        </span>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
            TONE_PILL[tone],
          )}
          title={`${days} day${days === 1 ? '' : 's'} in stage`}
        >
          {days}d
        </span>
      </div>
    </div>
  )
}

'use client'

import { AlertTriangle, Bot, ChevronRight, Loader2, RotateCcw, Undo2, User, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChangeView } from '@/lib/ads/commands/engine'
import {
  formatRelativeTime,
  isMachineActor,
  platformBadgeClass,
  platformLabel,
  riskBadgeVariant,
  riskLabel,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
} from './format'

export function ChangeRow({
  change,
  busy,
  onOpenDetail,
  onApprove,
  onCancel,
  onRetry,
  onRollback,
}: {
  change: ChangeView
  busy: boolean
  onOpenDetail: () => void
  onApprove: () => void
  onCancel: () => void
  onRetry: () => void
  onRollback: () => void
}) {
  const firstDiff = change.diff[0]
  const extraDiffCount = Math.max(0, change.diff.length - 1)
  const inFlight = change.status === 'executing' || change.status === 'verifying'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpenDetail() }}
      className="flex cursor-pointer items-start gap-4 border-b border-border-subtle bg-bg-primary px-5 py-4 transition-colors last:border-b-0 hover:bg-bg-secondary/50"
    >
      {/* Platform + risk */}
      <div className="flex w-[92px] shrink-0 flex-col gap-1.5">
        <span className={cn('inline-flex w-fit rounded-full px-2 py-0.5 text-[10.5px] font-medium', platformBadgeClass(change.platform))}>
          {platformLabel(change.platform)}
        </span>
        <Badge variant={riskBadgeVariant(change.risk_level)} className="w-fit">
          {riskLabel(change.risk_level)}
        </Badge>
      </div>

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-text-primary">{change.label}</span>
          {change.resource_name && (
            <span className="truncate text-[12.5px] text-text-tertiary">· {change.resource_name}</span>
          )}
        </div>

        {firstDiff && (
          <div className="text-[12.5px] text-text-secondary">
            <span className="text-text-tertiary">{firstDiff.label}:</span>{' '}
            <span className="text-text-primary">{firstDiff.beforeDisplay}</span>
            {' → '}
            <span className="font-medium text-text-primary">{firstDiff.afterDisplay}</span>
            {extraDiffCount > 0 && <span className="text-text-tertiary"> (+{extraDiffCount} more)</span>}
          </div>
        )}

        {change.warnings.length > 0 && (
          <div className="flex items-center gap-1.5 text-[12px] text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{change.warnings[0]}{change.warnings.length > 1 ? ` (+${change.warnings.length - 1} more)` : ''}</span>
          </div>
        )}

        {change.error_message && (
          <div className="flex items-center gap-1.5 text-[12px] text-red-400">
            <XCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{change.error_message}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
          {isMachineActor(change.actor_type) ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
          <span className="truncate max-w-[220px]">{change.actor_label ?? change.actor_type}</span>
          <span>·</span>
          <span>{formatRelativeTime(change.created_at)}</span>
        </div>
      </div>

      {/* Status + actions */}
      <div className="flex shrink-0 flex-col items-end gap-2" onClick={(e) => e.stopPropagation()}>
        <Badge variant={STATUS_BADGE_VARIANT[change.status]}>{STATUS_LABEL[change.status]}</Badge>

        <div className="flex items-center gap-1">
          {busy || inFlight ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />
          ) : (
            <>
              {change.status === 'awaiting_approval' && (
                <>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={onCancel}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" className="h-7 px-2.5 text-[11.5px]" onClick={onApprove}>
                    Approve
                  </Button>
                </>
              )}
              {change.status === 'queued' && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              {(change.status === 'failed' || change.status === 'expired' || change.status === 'cancelled' || change.status === 'drifted') && (
                <Button size="sm" variant="secondary" className="h-7 px-2 text-[11.5px]" onClick={onRetry}>
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </Button>
              )}
              {(change.status === 'succeeded' || change.status === 'drifted') && (
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11.5px]" onClick={onRollback}>
                  <Undo2 className="h-3 w-3" />
                  Roll back
                </Button>
              )}
            </>
          )}
          <button
            onClick={onOpenDetail}
            className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
            title="View details"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

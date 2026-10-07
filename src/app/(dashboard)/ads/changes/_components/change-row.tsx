'use client'

import { AlertTriangle, ArrowRight, Bot, ChevronRight, Loader2, Plus, RotateCcw, Undo2, User, XCircle } from 'lucide-react'
import { PlatformMark } from '@/components/ads/platform-mark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChangeView } from '@/lib/ads/commands/engine'
import {
  actorDisplay,
  formatRelativeTime,
  isMachineActor,
  riskDotClass,
  riskLabel,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
} from './format'

const EMPTY = new Set(['', '—', '-', 'null', 'none'])

/** "Status  ENABLED → PAUSED", or "New  [PHRASE] barbeiro" when there was nothing before. */
function DiffChip({ diff, extra }: { diff: ChangeView['diff'][number]; extra: number }) {
  const created = EMPTY.has(String(diff.beforeDisplay ?? '').trim().toLowerCase())
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px]">
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1">
        <span className="shrink-0 text-text-tertiary">{diff.label}</span>
        {created ? (
          <>
            <Plus className="h-3 w-3 shrink-0 text-success" />
            <span className="truncate font-medium text-text-primary">{diff.afterDisplay}</span>
          </>
        ) : (
          <>
            <span className="truncate text-text-tertiary line-through decoration-text-tertiary/50">{diff.beforeDisplay}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-text-tertiary" />
            <span className="truncate font-medium text-text-primary">{diff.afterDisplay}</span>
          </>
        )}
      </span>
      {extra > 0 && <span className="shrink-0 text-text-tertiary">+{extra} more</span>}
    </div>
  )
}

function Notice({ tone, icon: Icon, children }: { tone: 'warning' | 'danger'; icon: typeof AlertTriangle; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-center gap-1.5 text-[12px]', tone === 'danger' ? 'text-danger' : 'text-warning')}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  )
}

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
  const inFlight = change.status === 'executing' || change.status === 'verifying'
  const machine = isMachineActor(change.actor_type)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpenDetail() }}
      className="group flex cursor-pointer items-start gap-3.5 border-b border-border-subtle bg-bg-primary px-4 py-3.5 transition-colors last:border-b-0 hover:bg-bg-secondary/50 sm:px-5"
    >
      <PlatformMark platform={change.platform} className="mt-0.5" />

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-text-primary">{change.label}</span>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle px-1.5 py-px text-[10.5px] text-text-secondary"
              title={`Risk level ${change.risk_level} of 4`}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', riskDotClass(change.risk_level))} />
              {riskLabel(change.risk_level)}
            </span>
            {change.status !== 'awaiting_approval' && (
              <Badge variant={STATUS_BADGE_VARIANT[change.status]} className="shrink-0">{STATUS_LABEL[change.status]}</Badge>
            )}
          </div>
          {change.resource_name && <div className="truncate text-[12.5px] text-text-tertiary">{change.resource_name}</div>}
        </div>

        {firstDiff && <DiffChip diff={firstDiff} extra={Math.max(0, change.diff.length - 1)} />}

        {change.warnings.length > 0 && (
          <Notice tone="warning" icon={AlertTriangle}>
            {change.warnings[0]}
            {change.warnings.length > 1 ? ` (+${change.warnings.length - 1} more)` : ''}
          </Notice>
        )}
        {change.external_drift_detected_at && (
          <Notice tone="warning" icon={AlertTriangle}>
            Changed outside Xphere after it was applied ({formatRelativeTime(change.external_drift_detected_at)}) — the platform no longer matches.
          </Notice>
        )}
        {change.error_message && (
          <Notice tone="danger" icon={XCircle}>
            {change.error_message}
          </Notice>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary" title={change.actor_label ?? change.actor_type}>
          {machine ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
          <span className="hidden max-w-[160px] truncate sm:inline">{actorDisplay(change.actor_type, change.actor_label)}</span>
          <span className="hidden sm:inline">·</span>
          <span className="whitespace-nowrap">{formatRelativeTime(change.created_at)}</span>
        </div>

        <div className="flex items-center gap-1">
          {busy || inFlight ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />
          ) : (
            <>
              {change.status === 'awaiting_approval' && (
                <>
                  <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={onCancel}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" className="h-7 px-3 text-[12px]" onClick={onApprove}>
                    Approve
                  </Button>
                </>
              )}
              {change.status === 'queued' && (
                <Button size="sm" variant="ghost" className="h-7 px-2.5 text-[12px]" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              {(change.status === 'failed' || change.status === 'expired' || change.status === 'cancelled' || change.status === 'drifted') && (
                <Button size="sm" variant="secondary" className="h-7 px-2.5 text-[12px]" onClick={onRetry}>
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </Button>
              )}
              {(change.status === 'succeeded' || change.status === 'drifted') && (
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-[12px]" onClick={onRollback}>
                  <Undo2 className="h-3 w-3" />
                  Roll back
                </Button>
              )}
            </>
          )}
          <button
            onClick={onOpenDetail}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            title="View details"
            aria-label="View details"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

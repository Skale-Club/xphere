import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Skeleton variants used by the dashboard widgets. Each variant aims to
 * approximate the final layout so the loading flash doesn't cause layout
 * shift when the real widget arrives.
 */

export function MetricSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-5 flex flex-col gap-3 shadow-elevation-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-10" />
      </div>
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

export function PanelSkeleton({
  rows = 5,
  className,
  title = true,
}: {
  rows?: number
  className?: string
  title?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-5 flex flex-col gap-4 shadow-elevation-sm',
        className,
      )}
    >
      {title && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>
      )}
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

export function RowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Skeleton className="h-8 w-8 rounded-[8px] shrink-0" />
      <div className="flex-1 space-y-2 min-w-0">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-2/3" />
      </div>
      <Skeleton className="h-3 w-12 shrink-0" />
    </div>
  )
}

export function HeroSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-6 flex flex-col gap-3 shadow-elevation-sm',
        className,
      )}
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-1/2" />
      <div className="flex items-center gap-2 pt-2">
        <Skeleton className="h-7 w-28 rounded-[6px]" />
        <Skeleton className="h-7 w-28 rounded-[6px]" />
        <Skeleton className="h-7 w-28 rounded-[6px]" />
      </div>
    </div>
  )
}

export function GridSkeleton({
  tiles = 6,
  className,
}: {
  tiles?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-5 flex flex-col gap-4 shadow-elevation-sm',
        className,
      )}
    >
      <Skeleton className="h-4 w-32" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: tiles }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-[10px]" />
        ))}
      </div>
    </div>
  )
}

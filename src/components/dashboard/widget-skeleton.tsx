import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface MetricSkeletonProps {
  className?: string
}

function MetricSkeleton({ className }: MetricSkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-5 flex flex-col gap-3',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" rounded="full" />
        <Skeleton className="h-4 w-10" rounded="full" />
      </div>
      <Skeleton className="h-7 w-24" rounded="md" />
      <Skeleton className="h-10 w-full" rounded="md" />
    </div>
  )
}

interface PanelSkeletonProps {
  rows?: number
  className?: string
  title?: boolean
}

function PanelSkeleton({
  rows = 5,
  className,
  title = true,
}: PanelSkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-5 flex flex-col gap-4',
        className,
      )}
    >
      {title && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" rounded="md" />
          <Skeleton className="h-4 w-16" rounded="md" />
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

interface RowSkeletonProps {
  className?: string
  avatar?: boolean
}

function RowSkeleton({ className, avatar = true }: RowSkeletonProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {avatar && <Skeleton className="h-8 w-8 rounded-[8px] shrink-0" rounded="md" />}
      <div className="flex-1 space-y-2 min-w-0">
        <Skeleton className="h-3 w-1/3" rounded="md" />
        <Skeleton className="h-2.5 w-2/3" rounded="md" />
      </div>
      <Skeleton className="h-3 w-12 shrink-0" rounded="md" />
    </div>
  )
}

interface HeroSkeletonProps {
  className?: string
}

function HeroSkeleton({ className }: HeroSkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-6 flex flex-col gap-3',
        className,
      )}
    >
      <Skeleton className="h-3 w-24" rounded="md" />
      <Skeleton className="h-8 w-1/2" rounded="md" />
      <div className="flex items-center gap-2 pt-2">
        <Skeleton className="h-7 w-28" rounded="md" />
        <Skeleton className="h-7 w-28" rounded="md" />
        <Skeleton className="h-7 w-28" rounded="md" />
      </div>
    </div>
  )
}

interface GridSkeletonProps {
  tiles?: number
  className?: string
}

function GridSkeleton({ tiles = 6, className }: GridSkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-5 flex flex-col gap-4',
        className,
      )}
    >
      <Skeleton className="h-4 w-32" rounded="md" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: tiles }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-[10px]" rounded="lg" />
        ))}
      </div>
    </div>
  )
}

interface StatSkeletonProps {
  className?: string
}

function StatSkeleton({ className }: StatSkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-4 flex flex-col gap-2',
        className,
      )}
    >
      <Skeleton className="h-2.5 w-16" rounded="md" />
      <Skeleton className="h-6 w-20" rounded="md" />
      <Skeleton className="h-2.5 w-12" rounded="md" />
    </div>
  )
}

interface ChartSkeletonProps {
  className?: string
}

function ChartSkeleton({ className }: ChartSkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-5 flex flex-col gap-4',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" rounded="md" />
        <Skeleton className="h-4 w-20" rounded="md" />
      </div>
      <div className="flex items-end gap-2 h-32">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            rounded="md"
            style={{ height: `${Math.random() * 60 + 40}%` }}
          />
        ))}
      </div>
    </div>
  )
}

interface SparklineSkeletonProps {
  className?: string
}

function SparklineSkeleton({ className }: SparklineSkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-border bg-bg-secondary p-4 flex flex-col gap-2',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-16" rounded="md" />
        <Skeleton className="h-4 w-8" rounded="full" />
      </div>
      <Skeleton className="h-8 w-full" rounded="md" />
    </div>
  )
}

export {
  MetricSkeleton,
  PanelSkeleton,
  RowSkeleton,
  HeroSkeleton,
  GridSkeleton,
  StatSkeleton,
  ChartSkeleton,
  SparklineSkeleton,
}
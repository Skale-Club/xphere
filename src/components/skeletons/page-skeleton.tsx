import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface PageHeaderSkeletonProps {
  titleWidth?: string
  descriptionWidth?: string
  className?: string
}

function PageHeaderSkeleton({
  titleWidth = "w-40",
  descriptionWidth = "w-80",
  className,
}: PageHeaderSkeletonProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Skeleton className={cn("h-5", titleWidth)} />
      <Skeleton className={cn("h-4", descriptionWidth)} />
    </div>
  )
}

interface PageSkeletonProps {
  className?: string
}

function PageSkeleton({ className }: PageSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-6", className)}>
      <PageHeaderSkeleton />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  )
}

interface TablePageSkeletonProps {
  rows?: number
  filters?: boolean
  className?: string
}

function TablePageSkeleton({
  rows = 6,
  filters = false,
  className,
}: TablePageSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-5", className)}>
      <PageHeaderSkeleton />
      {filters && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-32 rounded-md" />
          ))}
        </div>
      )}
      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        <div className="grid gap-4 border-b border-border-subtle px-4 py-3 grid-cols-[repeat(4,minmax(0,1fr))]">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-4 items-center px-4 py-3.5 border-b border-border-subtle last:border-0 grid-cols-[repeat(4,minmax(0,1fr))]"
          >
            {Array.from({ length: 4 }).map((_, c) => (
              <Skeleton key={c} className="h-3 w-3/4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

interface ListPageSkeletonProps {
  rows?: number
  className?: string
}

function ListPageSkeleton({ rows = 6, className }: ListPageSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-5", className)}>
      <PageHeaderSkeleton />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  )
}

interface CardListSkeletonProps {
  cards?: number
  className?: string
}

function CardListSkeleton({ cards = 4, className }: CardListSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-5", className)}>
      <PageHeaderSkeleton />
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

interface SplitPageSkeletonProps {
  leftRows?: number
  rightCard?: boolean
  className?: string
}

function SplitPageSkeleton({
  leftRows = 5,
  rightCard = true,
  className,
}: SplitPageSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-6", className)}>
      <PageHeaderSkeleton />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          {Array.from({ length: leftRows }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
        {rightCard && <Skeleton className="h-72 w-full rounded-md" />}
      </div>
    </div>
  )
}

export {
  Skeleton,
  PageHeaderSkeleton,
  PageSkeleton,
  TablePageSkeleton,
  ListPageSkeleton,
  CardListSkeleton,
  SplitPageSkeleton,
}
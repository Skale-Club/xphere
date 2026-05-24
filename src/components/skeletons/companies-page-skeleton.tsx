import { Skeleton } from '@/components/ui/skeleton'

const TABLE_GRID = '40px 2.5fr 1.5fr 80px 80px 100px 1.2fr 90px'

export function CompaniesPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4 px-4 sm:px-6 lg:px-8 pb-2">
      {/* Custom fields filter bar skeleton */}
      <Skeleton className="h-9 w-full max-w-md rounded-[8px]" />

      {/* Table skeleton */}
      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        {/* Header */}
        <div
          className="grid items-center gap-3 px-4 py-2.5 border-b border-border-subtle"
          style={{ gridTemplateColumns: TABLE_GRID }}
        >
          <Skeleton className="h-4 w-4 rounded-[4px]" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-10 justify-self-end" />
        </div>

        {/* Rows */}
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="grid items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0"
            style={{ gridTemplateColumns: TABLE_GRID }}
          >
            <Skeleton className="h-4 w-4 rounded-[4px]" />
            <div className="flex items-center gap-2 min-w-0">
              <Skeleton className="h-3.5 w-3.5 rounded-[2px] shrink-0" />
              <Skeleton className="h-3.5 w-32" />
            </div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-16" />
            <div className="flex flex-wrap gap-1">
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-3 w-14 justify-self-end" />
          </div>
        ))}
      </div>

      {/* Pagination skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-32" />
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-8 w-20 rounded-[8px]" />
          <Skeleton className="h-8 w-14 rounded-[8px]" />
        </div>
      </div>
    </div>
  )
}

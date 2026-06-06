import { Skeleton } from '@/components/ui/skeleton'

function StatCardSkeleton() {
  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-5">
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex items-end gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-3 w-10 mb-0.5" />
      </div>
    </div>
  )
}

function TableCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
      <div className="px-5 py-3 border-b border-border-subtle">
        <Skeleton className="h-3.5 w-28" />
      </div>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[1.5fr_0.6fr_0.6fr] items-center px-5 py-2.5 border-b border-border/40 last:border-0"
          >
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-10 justify-self-end" />
            <Skeleton className="h-3 w-8 justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function TrafficPageSkeleton() {
  return (
    <div className="mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        <div className="px-5 py-3 border-b border-border-subtle">
          <Skeleton className="h-3.5 w-44" />
        </div>
        <div className="p-5">
          <Skeleton className="h-48 w-full rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TableCardSkeleton />
        <TableCardSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TableCardSkeleton />
        <TableCardSkeleton />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
          <div className="px-5 py-3 border-b border-border-subtle">
            <Skeleton className="h-3.5 w-24" />
          </div>
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-24 shrink-0" />
                <Skeleton className="h-1.5 flex-1 rounded-full" />
                <Skeleton className="h-3 w-6" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
          <div className="px-5 py-3 border-b border-border-subtle">
            <Skeleton className="h-3.5 w-20" />
          </div>
          <div className="p-5 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        <div className="px-5 py-3 border-b border-border-subtle">
          <Skeleton className="h-3.5 w-32" />
        </div>
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[1.4fr_0.8fr_0.4fr_0.8fr_0.5fr_0.5fr] items-center px-5 py-2.5 border-b border-border/40 last:border-0"
            >
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-4 rounded-sm" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-10 rounded-full justify-self-end" />
              <Skeleton className="h-3 w-10 justify-self-end" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

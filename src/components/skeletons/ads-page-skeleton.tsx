import { Skeleton } from '@/components/ui/skeleton'

function KpiCardSkeleton() {
  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-4">
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-3 w-3 rounded-sm" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-3 w-10" />
      </div>
      <Skeleton className="mt-3 h-2.5 w-full rounded-full" />
    </div>
  )
}

function ReviewCardSkeleton() {
  return (
    <div className="rounded-[10px] border border-border-subtle bg-bg-secondary p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <div className="flex-1 space-y-1">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-3 rounded-sm" />
        ))}
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

export function AdsPageSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-[12px] border border-border-subtle bg-bg-secondary p-4 space-y-4">
          <Skeleton className="h-3.5 w-28" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2 rounded-[12px] border border-border-subtle bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-8" />
            </div>
          </div>
          <Skeleton className="h-56 w-full rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-[12px] border border-border-subtle bg-bg-secondary p-4 space-y-3">
          <div>
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="mt-1 h-3 w-20" />
          </div>
          <div className="divide-y divide-border-subtle/50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2 rounded-[12px] border border-border-subtle bg-bg-secondary p-4 space-y-3">
          <Skeleton className="h-3.5 w-40" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-border-subtle/60 bg-bg-tertiary/40 p-2.5"
              >
                <Skeleton className="h-7 w-7 rounded-md shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <div className="rounded-[12px] border border-border bg-bg-secondary p-4 space-y-3">
          <div className="grid grid-cols-4 gap-3 pb-2 border-b border-border-subtle">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-20" />
            ))}
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-4 gap-3 items-center">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[12px] border border-border bg-bg-secondary p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ReviewCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

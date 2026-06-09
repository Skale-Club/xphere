import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/layout/page-header'

function PreviewReviewCardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-[14px] border border-zinc-200 bg-white p-4 space-y-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 rounded-full shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-2.5 w-1/4" />
        </div>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-3 rounded-sm" />
        ))}
      </div>
      {!compact && (
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}
    </div>
  )
}

export function ReviewsPageSkeleton() {
  return (
    <PageContainer>
    <section className="overflow-hidden rounded-[8px] border border-border bg-bg-secondary">
      <div className="grid gap-0 lg:grid-cols-[360px_1fr]">
        <aside className="border-b border-border-subtle p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-9 rounded-[9px]" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>

          <div className="mt-5 space-y-5">
            <div className="space-y-2">
              <Skeleton className="h-3 w-12" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-[8px]" />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ))}
            </div>

            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-[8px] border border-border bg-bg-tertiary/50 px-3 py-2"
              >
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}

            <div className="space-y-2">
              <Skeleton className="h-3 w-12" />
              <div className="grid grid-cols-2 overflow-hidden rounded-[8px] border border-border bg-bg-tertiary/50 p-1">
                <Skeleton className="h-7 rounded-[6px]" />
                <Skeleton className="h-7 rounded-[6px] opacity-0" />
              </div>
            </div>
          </div>
        </aside>

        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-8 w-32 rounded-md" />
          </div>

          <div
            className="max-h-[760px] overflow-auto rounded-[16px] border border-zinc-200 bg-[#fafaf7] p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <section className="mb-4 rounded-[16px] border border-zinc-200 p-5 dark:border-white/10">
              <div className="grid gap-5 md:grid-cols-[1fr_220px] md:items-center">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                  <div className="mt-4 flex items-baseline gap-3">
                    <Skeleton className="h-10 w-16" />
                    <div className="space-y-1.5">
                      <div className="flex gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Skeleton key={i} className="h-4 w-4 rounded-sm" />
                        ))}
                      </div>
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <Skeleton className="mt-4 h-9 w-32 rounded-full" />
                </div>
                <div className="space-y-1.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Skeleton className="h-3 w-8" />
                      <Skeleton className="h-2 flex-1 rounded-full" />
                      <Skeleton className="h-3 w-6" />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <PreviewReviewCardSkeleton key={i} compact />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
    </PageContainer>
  )
}

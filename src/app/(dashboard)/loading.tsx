import { PageSkeleton } from '@/components/skeletons/page-skeleton'

export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[12px] border border-border bg-bg-secondary p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-3 w-20 shimmer rounded-full" />
              <div className="h-4 w-10 shimmer rounded-full" />
            </div>
            <div className="h-7 w-24 shimmer rounded-md" />
            <div className="h-10 w-full shimmer rounded-md" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[12px] border border-border bg-bg-secondary p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-4 w-32 shimmer rounded-md" />
            <div className="h-4 w-16 shimmer rounded-md" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 shimmer rounded-[8px]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 shimmer rounded-md" />
                  <div className="h-2.5 w-2/3 shimmer rounded-md" />
                </div>
                <div className="h-3 w-12 shimmer rounded-md" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[12px] border border-border bg-bg-secondary p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-4 w-32 shimmer rounded-md" />
            <div className="h-4 w-16 shimmer rounded-md" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 shimmer rounded-[8px]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 shimmer rounded-md" />
                  <div className="h-2.5 w-2/3 shimmer rounded-md" />
                </div>
                <div className="h-3 w-12 shimmer rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
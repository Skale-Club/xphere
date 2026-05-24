import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

function TaskItemSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg">
      <Skeleton className="mt-0.5 h-4 w-4 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-3 w-14 hidden sm:inline" />
        </div>
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  )
}

function TaskGroupSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 mb-1 px-4">
        <Skeleton className="h-2 w-2 rounded-full shrink-0" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-8" />
      </div>
      <Skeleton className="mb-2 ml-4 h-px w-full" />
      {Array.from({ length: items }).map((_, i) => (
        <TaskItemSkeleton key={i} />
      ))}
    </div>
  )
}

export function TasksPageSkeleton() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Filter bar skeleton */}
      <div className="flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <Button size="sm" className="h-8 gap-1.5 shrink-0" disabled>
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Task</span>
        </Button>
        <Skeleton className="h-8 w-full max-w-[200px] sm:max-w-xs rounded-[8px]" />
        <div className="hidden sm:block flex-1" />
        <div className="hidden sm:flex items-center gap-2">
          <Skeleton className="h-8 w-16 rounded-[8px]" />
          <Skeleton className="h-8 w-16 rounded-[8px]" />
          <Skeleton className="h-8 w-[90px] rounded-[8px]" />
          <Skeleton className="h-8 w-[110px] rounded-[8px]" />
        </div>
        <div className="sm:hidden flex items-center gap-1.5">
          <Skeleton className="h-8 w-8 rounded-[8px]" />
          <Skeleton className="h-8 w-8 rounded-[8px]" />
          <Skeleton className="h-8 w-8 rounded-[8px]" />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Grouped list */}
        <div className="flex-1 overflow-y-auto py-4 px-4 sm:px-6 lg:px-8 space-y-6">
          <TaskGroupSkeleton items={4} />
          <TaskGroupSkeleton items={3} />
          <TaskGroupSkeleton items={2} />
        </div>

        {/* Desktop calendar sidebar */}
        <div className="hidden lg:flex flex-col w-72 shrink-0 border-l border-border p-4 overflow-y-auto space-y-4">
          {/* Mini calendar */}
          <div className="rounded-xl border border-border bg-bg-secondary p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <div className="flex gap-1">
                <Skeleton className="h-6 w-6 rounded-[6px]" />
                <Skeleton className="h-6 w-6 rounded-[6px]" />
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={`h${i}`} className="h-3 w-full" />
              ))}
              {Array.from({ length: 28 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full rounded-[6px]" />
              ))}
            </div>
          </div>
          {/* Calendar filters */}
          <div className="rounded-xl border border-border bg-bg-secondary p-3 space-y-2">
            <Skeleton className="h-3 w-24" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-14 rounded-full" />
              <Skeleton className="h-7 w-12 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-14 rounded-full" />
              <Skeleton className="h-7 w-14 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

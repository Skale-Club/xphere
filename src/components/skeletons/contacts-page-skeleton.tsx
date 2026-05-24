import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

const TABLE_GRID = '40px 2fr 1.5fr 1.2fr 1fr 100px'

export function ContactsPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar skeleton */}
      <div className="flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <Button size="sm" className="h-8 shrink-0" disabled>
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Contact</span>
        </Button>
        <Skeleton className="h-8 w-full max-w-[200px] sm:max-w-xs rounded-[8px]" />
        <div className="hidden sm:block flex-1" />
        <div className="hidden sm:flex items-center gap-2">
          <Skeleton className="h-8 w-[140px] rounded-[8px]" />
        </div>
        <div className="sm:hidden">
          <Skeleton className="h-8 w-9 rounded-[8px]" />
        </div>
        <Skeleton className="h-8 w-9 rounded-[8px]" />
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-2 space-y-4">
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
            <Skeleton className="h-3 w-12 justify-self-end" />
          </div>

          {/* Rows */}
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="grid items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0"
              style={{ gridTemplateColumns: TABLE_GRID }}
            >
              <Skeleton className="h-4 w-4 rounded-[4px]" />
              <div className="flex items-center gap-2.5 min-w-0">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="min-w-0 space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-28" />
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
    </div>
  )
}

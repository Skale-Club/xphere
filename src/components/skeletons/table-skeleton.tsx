import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface TableSkeletonProps {
  rows?: number
  columns?: number
  className?: string
}

export function TableSkeleton({ rows = 6, columns = 4, className }: TableSkeletonProps) {
  return (
    <div className={cn('rounded-[12px] border border-border bg-bg-secondary overflow-hidden', className)}>
      <div className="grid border-b border-border-subtle px-4 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid items-center px-4 py-3.5 border-b border-border-subtle last:border-0"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-3 w-3/4" />
          ))}
        </div>
      ))}
    </div>
  )
}

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function MetricSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-[12px] border border-border bg-bg-secondary p-5 flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-10" />
      </div>
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}

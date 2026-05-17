import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface CardSkeletonProps {
  lines?: number
  className?: string
}

export function CardSkeleton({ lines = 3, className }: CardSkeletonProps) {
  return (
    <div className={cn('rounded-[12px] border border-border bg-bg-secondary p-5 space-y-3', className)}>
      <Skeleton className="h-3.5 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-2.5 w-full" />
      ))}
    </div>
  )
}

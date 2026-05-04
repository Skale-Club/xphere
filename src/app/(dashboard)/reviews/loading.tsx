import { Skeleton } from '@/components/ui/skeleton'

export default function ReviewsLoading() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-1 h-4 w-80" />
      </div>
      <Skeleton className="h-40 w-full rounded-md" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-md" />
        ))}
      </div>
    </div>
  )
}

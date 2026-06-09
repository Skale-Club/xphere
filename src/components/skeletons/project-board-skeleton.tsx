import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const COLUMNS: { label: string; cards: number }[] = [
  { label: 'Backlog', cards: 2 },
  { label: 'To Do', cards: 3 },
  { label: 'Doing', cards: 2 },
  { label: 'Done', cards: 1 },
]

const PRIORITY_BAR = ['bg-red-500/70', 'bg-orange-500/70', 'bg-yellow-500/70', 'bg-green-500/70']

function TaskCardSkeleton({ variant = 0 }: { variant?: number }) {
  const bar = PRIORITY_BAR[variant % PRIORITY_BAR.length]
  return (
    <div className="rounded-[10px] border border-border-subtle bg-background p-3 shadow-sm">
      <div className="flex items-stretch gap-2.5">
        <div className={cn('w-1 self-stretch rounded-full shrink-0', bar)} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-4 w-12 rounded-full shrink-0" />
          </div>

          {variant % 2 === 0 && (
            <div className="flex gap-1">
              <Skeleton className="h-3.5 w-12 rounded-full" />
              <Skeleton className="h-3.5 w-8 rounded-full" />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

function BoardColumnSkeleton({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex h-full max-h-full w-[80vw] sm:w-[300px] shrink-0 flex-col rounded-[12px] border border-border-subtle bg-bg-secondary/40 snap-center sm:snap-align-none">
      <div className="flex items-center justify-between px-3 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-6 rounded-full" />
        </div>
        <Skeleton className="h-3.5 w-3.5 rounded-sm" />
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <TaskCardSkeleton key={i} variant={i} />
        ))}
      </div>

      <div className="p-2 border-t border-border-subtle">
        <Skeleton className="h-8 w-full rounded-md" />
      </div>
    </div>
  )
}

export function ProjectBoardSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-3">
        <div className="flex items-center gap-4 min-w-0">
          <Skeleton className="h-8 w-20 rounded-md shrink-0" />
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 border border-border/40">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-md" />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-3">
        <Skeleton className="h-9 w-full max-w-xl rounded-lg" />
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 sm:px-6 lg:px-8 pb-2 snap-x snap-mandatory sm:snap-none">
        {COLUMNS.map((col) => (
          <BoardColumnSkeleton key={col.label} label={col.label} count={col.cards} />
        ))}
      </div>
    </div>
  )
}

import { Skeleton } from '@/components/ui/skeleton'

function ConversationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Skeleton className="h-9 w-9 rounded-full shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-2.5 w-8" />
        </div>
        <Skeleton className="h-3 w-full" />
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3.5 w-3.5 rounded-[4px]" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    </div>
  )
}

function MessageBubbleSkeleton({ align }: { align: 'left' | 'right' }) {
  return (
    <div className={`flex ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] space-y-1 ${align === 'right' ? 'items-end' : 'items-start'}`}>
        <Skeleton className="h-4 w-48 rounded-xl" />
        <Skeleton className="h-4 w-32 rounded-xl" />
        <Skeleton className="h-2.5 w-10" />
      </div>
    </div>
  )
}

export function ChatPageSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden bg-bg-primary">
      {/* Desktop | 3-column grid */}
      <div className="hidden md:flex h-full min-h-0 w-full overflow-hidden">
        {/* Conversation list column */}
        <div className="h-full min-h-0 shrink-0 overflow-hidden" style={{ width: 300 }}>
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
            <Skeleton className="h-7 w-16 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-14 rounded-full" />
          </div>
          {/* Conversation items */}
          <div className="divide-y divide-border-subtle">
            {Array.from({ length: 8 }).map((_, i) => (
              <ConversationItemSkeleton key={i} />
            ))}
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle">
            <Skeleton className="h-3 w-20" />
            <div className="flex items-center gap-1">
              <Skeleton className="h-7 w-7 rounded-[6px]" />
              <Skeleton className="h-7 w-7 rounded-[6px]" />
            </div>
          </div>
        </div>

        {/* Resize handle */}
        <div className="relative z-20 h-full w-1 -ml-px shrink-0">
          <span className="absolute inset-y-0 left-0 w-px bg-border-subtle" />
        </div>

        {/* Chat area column */}
        <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden flex flex-col">
          {/* Chat header */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border-subtle shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-7 w-7 rounded-[6px]" />
              <Skeleton className="h-7 w-7 rounded-[6px]" />
              <Skeleton className="h-7 w-7 rounded-[6px]" />
            </div>
          </div>
          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-hidden px-4 py-4 space-y-4">
            <MessageBubbleSkeleton align="left" />
            <MessageBubbleSkeleton align="right" />
            <MessageBubbleSkeleton align="left" />
            <MessageBubbleSkeleton align="left" />
            <MessageBubbleSkeleton align="right" />
          </div>
          {/* Composer */}
          <div className="shrink-0 border-t border-border-subtle px-4 py-3">
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>

        {/* Info panel column */}
        <div className="hidden lg:flex h-full min-h-0 shrink-0 overflow-hidden w-[300px] xl:w-[340px] flex-col border-l border-border-subtle">
          {/* Bot status bar */}
          <div className="shrink-0 px-4 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-1.5 w-1.5 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-12" />
          </div>
          {/* Contact info */}
          <div className="flex-1 min-h-0 overflow-hidden px-4 py-4 space-y-4">
            <div className="flex flex-col items-center gap-2">
              <Skeleton className="h-16 w-16 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-8 w-full rounded-[8px]" />
              <Skeleton className="h-8 w-full rounded-[8px]" />
              <Skeleton className="h-8 w-full rounded-[8px]" />
            </div>
            <div className="space-y-2 pt-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-20 w-full rounded-[8px]" />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile | single column — conversation list */}
      <div className="md:hidden flex h-full min-h-0 w-full overflow-hidden flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-14 rounded-full" />
        </div>
        <div className="divide-y divide-border-subtle flex-1 overflow-hidden">
          {Array.from({ length: 10 }).map((_, i) => (
            <ConversationItemSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function StageColumnSkeleton() {
  return (
    <div className="flex h-full max-h-full w-[300px] shrink-0 flex-col rounded-[12px] border border-border-subtle bg-bg-secondary/40 overflow-hidden">
      {/* Stage colour stripe */}
      <Skeleton className="h-[3px] w-full shrink-0 rounded-none" />
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-4 w-6 rounded-full" />
        </div>
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="flex-1 px-2 pb-2 space-y-1.5 min-h-[200px]">
        <div className="rounded-[10px] border border-border-subtle bg-bg-secondary p-3 space-y-2">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex items-center justify-between pt-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-10" />
          </div>
        </div>
        <div className="rounded-[10px] border border-border-subtle bg-bg-secondary p-3 space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex items-center justify-between pt-1">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PipelinePageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar skeleton */}
      <div className="flex flex-row flex-nowrap items-center justify-between gap-1.5 sm:gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8 shrink-0" disabled>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Deal</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-[100px] rounded-[8px]" />
          <Skeleton className="h-8 w-[80px] rounded-[8px]" />
          <Skeleton className="h-8 w-[90px] rounded-[8px]" />
        </div>
      </div>

      {/* Kanban columns skeleton */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 sm:px-6 lg:px-8 pb-2">
        <StageColumnSkeleton />
        <StageColumnSkeleton />
        <StageColumnSkeleton />
        <StageColumnSkeleton />
      </div>
    </div>
  );
}

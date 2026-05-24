import { KanbanSquare, LayoutList, Plus, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PipelineListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 pt-6 pb-6">
      <div className="flex flex-row flex-nowrap items-center justify-between gap-1.5 sm:gap-2 pb-6">
        <Button size="sm" className="h-8 shrink-0" disabled>
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Deal</span>
        </Button>

        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-[100px] rounded-[8px]" />
          <div className="flex h-8 items-center overflow-hidden rounded-[8px] border border-border-subtle bg-bg-secondary">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-none px-2.5"
              disabled
              aria-label="Kanban view"
            >
              <KanbanSquare className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-none bg-bg-tertiary px-2.5"
              disabled
              aria-label="List view"
            >
              <LayoutList className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button variant="secondary" size="sm" className="h-8" disabled>
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
        </div>
      </div>

      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        <div className="grid gap-4 border-b border-border-subtle px-4 py-3 grid-cols-[repeat(4,minmax(0,1fr))]">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-4 items-center px-4 py-3.5 border-b border-border-subtle last:border-0 grid-cols-[repeat(4,minmax(0,1fr))]"
          >
            {Array.from({ length: 4 }).map((_, c) => (
              <Skeleton key={c} className="h-3 w-3/4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

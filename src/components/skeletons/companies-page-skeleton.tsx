import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const TABLE_GRID = "40px 2.5fr 1.5fr 80px 80px 100px 1.2fr 90px";

export function CompaniesPageSkeleton({
  rows = 6,
  includeToolbar = false,
}: {
  rows?: number;
  includeToolbar?: boolean;
}) {
  return (
    <div>
      {includeToolbar && (
        <div className="flex flex-row flex-nowrap items-center gap-1.5 sm:gap-2 px-4 sm:px-6 lg:px-8 pt-6 pb-6">
          <Button size="sm" className="h-8 shrink-0" disabled>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Company</span>
          </Button>
          <Skeleton className="h-8 w-full max-w-[200px] sm:max-w-xs rounded-[8px]" />
          <div className="hidden sm:block flex-1" />
          <div className="hidden sm:flex items-center gap-2">
            <Skeleton className="h-8 w-[130px] rounded-[8px]" />
            <Skeleton className="h-8 w-[110px] rounded-[8px]" />
            <Skeleton className="h-8 w-[100px] rounded-[8px]" />
            <Skeleton className="h-8 w-[100px] rounded-[8px]" />
            <Skeleton className="h-8 w-[120px] rounded-[8px]" />
            <Skeleton className="h-8 w-9 rounded-[8px]" />
          </div>
          <div className="sm:hidden flex items-center gap-1.5">
            <Skeleton className="h-8 w-9 rounded-[8px]" />
            <Skeleton className="h-8 w-9 rounded-[8px]" />
          </div>
        </div>
      )}

      <div className="space-y-4 px-4 sm:px-6 lg:px-8 pb-2">
        {/* Custom fields filter bar skeleton */}
        <Skeleton className="h-9 w-full max-w-md rounded-[8px]" />

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
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-10 justify-self-end" />
          </div>

          {/* Rows */}
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="grid items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0"
              style={{ gridTemplateColumns: TABLE_GRID }}
            >
              <Skeleton className="h-4 w-4 rounded-[4px]" />
              <div className="flex items-center gap-2 min-w-0">
                <Skeleton className="h-3.5 w-3.5 rounded-[2px] shrink-0" />
                <Skeleton className="h-3.5 w-32" />
              </div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-16" />
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
  );
}

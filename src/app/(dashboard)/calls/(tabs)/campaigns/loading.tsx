import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function CallsCampaignsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="mb-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div />
        <div className="flex items-center gap-4">
          <Skeleton className="h-4 w-24" />
          <Button size="sm" className="h-8" disabled>
            <Plus className="h-4 w-4 mr-1" />
            New Campaign
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <div className="grid grid-cols-[2fr_repeat(5,minmax(0,1fr))_80px] gap-4 border-b px-4 py-3">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-3 w-20" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, row) => (
          <div
            key={row}
            className="grid grid-cols-[2fr_repeat(5,minmax(0,1fr))_80px] items-center gap-4 border-b px-4 py-3 last:border-0"
          >
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-3.5 w-12 justify-self-end" />
            <Skeleton className="h-3.5 w-12 justify-self-end" />
            <Skeleton className="h-3.5 w-12 justify-self-end" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-8 w-16 rounded-[8px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

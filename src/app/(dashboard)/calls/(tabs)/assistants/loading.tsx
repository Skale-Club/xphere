import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function CallsAssistantsLoading() {
  return (
    <div>
      <div className="-mt-6 flex items-center gap-2 pb-4">
        <Button className="h-8" disabled>
          <Plus className="h-4 w-4 mr-2" />
          Link Vapi Assistant
        </Button>
      </div>

      <div className="rounded-md border">
        <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_40px] gap-4 border-b px-4 py-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-3 w-24" />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, row) => (
          <div
            key={row}
            className="grid grid-cols-[repeat(4,minmax(0,1fr))_40px] items-center gap-4 border-b px-4 py-3 last:border-0"
          >
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-8 w-8 rounded-[8px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

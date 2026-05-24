import { ArrowLeft, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function EmailSectionsLoading() {
  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Button variant="ghost" size="sm" className="h-8" disabled>
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Templates
      </Button>

      <div className="flex items-center justify-end">
        <Button size="sm" className="h-8 gap-1.5" disabled>
          <Plus className="h-3.5 w-3.5" />
          Nova seção
        </Button>
      </div>

      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 px-4 py-3 bg-card"
            >
              <Skeleton className="h-5 w-16 rounded-full shrink-0" />
              <Skeleton className="h-4 w-48 flex-1" />
              <Skeleton className="h-7 w-14 rounded-[8px]" />
              <Skeleton className="h-7 w-7 rounded-[8px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotesLoading() {
  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex justify-end">
        <Button size="sm" className="h-8 gap-1.5" disabled>
          <Plus className="h-3.5 w-3.5" />
          New Note
        </Button>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="rounded-lg border border-border bg-card p-4 space-y-3"
          >
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <div className="flex items-center justify-between pt-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

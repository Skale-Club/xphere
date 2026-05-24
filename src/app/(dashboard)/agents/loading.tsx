import { Plus, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <div className="px-0 py-0 space-y-0">
      <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <Button size="sm" className="h-8 w-8 px-0 sm:w-auto sm:px-3" disabled>
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Agent</span>
        </Button>
        <Button variant="secondary" size="sm" className="h-8" disabled>
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-2">
        <div className="rounded-[12px] border border-border bg-bg-secondary shadow-elevation-sm overflow-hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0 sm:grid-cols-[repeat(4,minmax(0,1fr))_80px_100px_40px]"
            >
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20 sm:hidden" />
              </div>
              <Skeleton className="hidden h-3 w-20 sm:block" />
              <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
              <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
              <Skeleton className="h-6 w-11 rounded-full" />
              <Skeleton className="hidden h-3 w-16 sm:block" />
              <Skeleton className="h-8 w-8 rounded-[8px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

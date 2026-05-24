import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function CallsAssistantsLoading() {
  return (
    <div className="flex flex-col">
      <div className="-mt-6 flex items-center gap-2 pb-4">
        <Button size="sm" className="h-8" disabled>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Link Vapi Assistant
        </Button>
      </div>

      <div className="pb-8">
        <div className="overflow-hidden rounded-[12px] border border-border bg-bg-secondary">
          <div
            className="hidden items-center gap-3 border-b border-border-subtle bg-bg-secondary px-4 py-2.5 md:grid"
            style={{ gridTemplateColumns: "2fr 2fr 140px 100px 48px" }}
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-12 justify-self-end" />
            <div />
          </div>

          <div className="divide-y divide-border-subtle">
            {Array.from({ length: 4 }).map((_, row) => (
              <div key={row}>
                <div className="px-3 py-3 md:hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-36" />
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-3 w-10" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-8 shrink-0 rounded-[8px]" />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-6 w-11 rounded-full" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>

                <div
                  className="hidden items-center gap-3 px-4 py-3 md:grid"
                  style={{
                    gridTemplateColumns: "2fr 2fr 140px 100px 48px",
                  }}
                >
                  <Skeleton className="h-3.5 w-36" />
                  <div className="flex min-w-0 items-center gap-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-11 rounded-full" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-16 justify-self-end" />
                  <Skeleton className="h-8 w-8 justify-self-end rounded-[8px]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

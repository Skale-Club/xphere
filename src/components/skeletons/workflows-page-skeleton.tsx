import {
  Archive,
  FolderPlus,
  MoreHorizontal,
  Plus,
  ScrollText,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkflowsPageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="px-0 py-0 space-y-0">
      <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <div className="hidden items-center gap-2 sm:flex">
          <Button size="sm" className="h-8" disabled>
            <Plus className="h-3.5 w-3.5" />
            Workflow
          </Button>
          <Button variant="outline" size="sm" className="h-8" disabled>
            <FolderPlus className="h-3.5 w-3.5" />
            Folder
          </Button>
        </div>

        <div className="flex items-center gap-2 sm:hidden">
          <Button
            size="sm"
            className="h-8 w-8 px-0"
            disabled
            aria-label="Workflow"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 px-0"
            disabled
            aria-label="Folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <Button variant="ghost" size="sm" className="h-8" disabled>
            <Archive className="h-3.5 w-3.5" />
            Show archived
          </Button>
          <Button variant="ghost" size="sm" className="relative h-8" disabled>
            <Trash2 className="h-3.5 w-3.5" />
            Trash
          </Button>
          <Button variant="outline" size="sm" className="h-8" disabled>
            <ScrollText className="h-3.5 w-3.5" />
            Logs
          </Button>
        </div>

        <div className="lg:hidden">
          <Button
            variant="secondary"
            size="icon-sm"
            className="h-8 w-8"
            disabled
            aria-label="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-2">
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={index}
              className="rounded-lg border border-border-subtle bg-bg-secondary/30 overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary/60 border-b border-border-subtle">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-3.5 rounded-[4px]" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-[18px] w-6 rounded-full" />
                </div>
                <Skeleton className="h-4 w-4 rounded-[4px]" />
              </div>
              <div className="px-3 py-3 lg:px-4">
                <div className="flex items-center gap-2 lg:grid lg:grid-cols-[32px_40px_minmax(0,1.5fr)_minmax(0,1fr)_96px_120px_36px]">
                  <Skeleton className="h-7 w-7 shrink-0 rounded-[7px]" />
                  <Skeleton className="h-8 w-8 shrink-0 rounded-[7px]" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-20 lg:hidden" />
                  </div>
                  <Skeleton className="hidden h-3 w-20 lg:block" />
                  <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
                  <Skeleton className="hidden h-3 w-16 justify-self-end lg:block" />
                  <Skeleton className="h-7 w-7 shrink-0 rounded-[7px]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

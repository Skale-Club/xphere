// SEED-025 Phase E: unified workflows page. No more tabs separating
// "Action Tools" and "Visual Flows" | everything is a Workflow with a
// kind/trigger badge, surfaced in one list.
//
// SEED-038: adds folders, archive toggle (?archived=1), and trash entry.

import Link from "next/link";
import { MoreHorizontal, ScrollText, Trash2, Archive } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageContainer } from "@/components/layout/page-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { listUnifiedWorkflows } from "@/lib/workflows/list";
import { WorkflowsList } from "@/components/workflows/workflows-list";
import { NewFolderButton } from "@/components/workflows/new-folder-button";
import { NewWorkflowButton } from "@/components/flows/new-workflow-button";
import type { Database } from "@/types/database";

type WorkflowFolderRow =
  Database["public"]["Tables"]["workflow_folders"]["Row"];

interface PageProps {
  searchParams: Promise<{ archived?: string }>;
}

export default async function WorkflowsPage({ searchParams }: PageProps) {
  const { archived } = await searchParams;
  const includeArchived = archived === "1";

  const supabase = await createClient();
  const { data: orgId } = await supabase.rpc("get_current_org_id");

  const [workflows, foldersRes, trashCountRes] = await Promise.all([
    orgId
      ? listUnifiedWorkflows(orgId as string, supabase, { includeArchived })
      : Promise.resolve([]),
    orgId
      ? supabase
          .from("workflow_folders")
          .select("*")
          .order("position", { ascending: true })
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as WorkflowFolderRow[] }),
    orgId
      ? supabase
          .from("workflows")
          .select("id", { count: "exact", head: true })
          .not("deleted_at", "is", null)
      : Promise.resolve({ count: 0 }),
  ]);

  const folders = ((foldersRes as { data: WorkflowFolderRow[] | null }).data ??
    []) as WorkflowFolderRow[];
  const trashCount = (trashCountRes as { count: number | null }).count ?? 0;

  return (
    <PageContainer className="px-0 py-0 space-y-0">
      <div className="animate-fade-in flex items-center justify-between pl-1 sm:pl-3 lg:pl-5 pr-1 sm:pr-3 lg:pr-5 pt-6 pb-6">
        <div className="hidden items-center gap-2 sm:flex">
          <NewWorkflowButton label="Workflow" className="h-8" />
          <NewFolderButton className="h-8" />
        </div>

        <div className="flex items-center gap-2 sm:hidden">
          <NewWorkflowButton
            label="Workflow"
            iconOnly
            className="h-8 w-8 px-0"
          />
          <NewFolderButton iconOnly className="h-8 w-8 px-0" />
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <Button
            asChild
            variant={includeArchived ? "default" : "ghost"}
            size="sm"
            className="h-8"
          >
            <Link
              href={includeArchived ? "/workflows" : "/workflows?archived=1"}
            >
              <Archive className="h-3.5 w-3.5" />
              {includeArchived ? "Hide archived" : "Show archived"}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="relative h-8">
            <Link href="/workflows/trash">
              <Trash2 className="h-3.5 w-3.5" />
              Trash
              {trashCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500/15 text-rose-500 text-[10px] font-semibold">
                  {trashCount}
                </span>
              )}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href="/workflows/logs">
              <ScrollText className="h-3.5 w-3.5" /> Logs
            </Link>
          </Button>
        </div>

        <div className="lg:hidden">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="h-8 w-8"
                    aria-label="More"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">More</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link
                  href={
                    includeArchived ? "/workflows" : "/workflows?archived=1"
                  }
                >
                  <Archive className="h-3.5 w-3.5" />
                  {includeArchived ? "Hide archived" : "Show archived"}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/workflows/trash">
                  <Trash2 className="h-3.5 w-3.5" />
                  Trash
                  {trashCount > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500/15 text-rose-500 text-[10px] font-semibold">
                      {trashCount}
                    </span>
                  )}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/workflows/logs">
                  <ScrollText className="h-3.5 w-3.5" />
                  Logs
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-2">
        <WorkflowsList workflows={workflows} folders={folders} />
      </div>
    </PageContainer>
  );
}

// /workflows has no buffer index | the sub-sidebar owns the list of workflows
// and folders. The main area is a prompt: pick a workflow from the sidebar to
// open it, or — when the org has none yet — an instructive empty state inviting
// the user to create their first one.

import { Workflow } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/page-header";
import { NewWorkflowButton } from "@/components/flows/new-workflow-button";
import { listUnifiedWorkflows } from "@/lib/workflows/list";

export default async function WorkflowsPage() {
  const supabase = await createClient();
  const { data: orgId } = await supabase.rpc("get_current_org_id");

  const workflows = orgId
    ? await listUnifiedWorkflows(orgId as string, supabase, {
        includeArchived: false,
      })
    : [];

  const isEmpty = workflows.length === 0;

  return (
    <PageContainer>
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-bg-tertiary/70 text-text-tertiary">
          <Workflow className="h-6 w-6" />
        </div>
        {isEmpty ? (
          <>
            <h2 className="text-[15px] font-semibold text-text-primary">
              No workflows yet
            </h2>
            <p className="mt-1 max-w-sm text-[13px] text-text-tertiary">
              Workflows automate actions across your integrations. Create your
              first one to get started.
            </p>
            <div className="mt-5">
              <NewWorkflowButton label="New workflow" />
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[15px] font-semibold text-text-primary">
              Select a workflow
            </h2>
            <p className="mt-1 max-w-sm text-[13px] text-text-tertiary">
              Pick a workflow from the sidebar to view and edit it, or create a
              new one.
            </p>
            <div className="mt-5">
              <NewWorkflowButton label="New workflow" />
            </div>
          </>
        )}
      </div>
    </PageContainer>
  );
}

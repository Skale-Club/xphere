import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-header";
import { AgentsTable } from "@/components/agents/agents-table";
import { AgentSettingsButton } from "@/components/agents/agent-settings-button";
import { getAgents, getActiveAgents, getChannelDefaults } from "./actions";

export default async function AgentsPage() {
  const [agents, channelDefaults, activeAgents] = await Promise.all([
    getAgents(),
    getChannelDefaults(),
    getActiveAgents(),
  ]);

  return (
    <PageContainer className="px-0 py-0 space-y-0">
      <div className="animate-fade-in flex items-center justify-between px-4 sm:px-6 lg:px-8 pt-6 pb-6">
        <Button asChild size="sm" className="h-8 w-8 px-0 sm:w-auto sm:px-3">
          <Link href="/agents/new">
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Agent</span>
          </Link>
        </Button>
        <AgentSettingsButton defaults={channelDefaults} agents={activeAgents} />
      </div>

      <div className="px-4 sm:px-6 lg:px-8 pb-2">
        <AgentsTable agents={agents} channelDefaults={channelDefaults} />
      </div>
    </PageContainer>
  );
}

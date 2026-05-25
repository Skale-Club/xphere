import { PageContainer } from "@/components/layout/page-header";
import { AgentSettingsButton } from "@/components/agents/agent-settings-button";
import { AgentsClient } from "./agents-client";
import { getAgents, getActiveAgents, getChannelDefaults } from "./actions";

interface AgentsPageProps {
  searchParams: Promise<{ showInactive?: string }>;
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const [{ showInactive }, agents, channelDefaults, activeAgents] = await Promise.all([
    searchParams,
    getAgents(),
    getChannelDefaults(),
    getActiveAgents(),
  ]);

  const defaultShowInactive = showInactive !== "false";

  return (
    <PageContainer className="py-0 space-y-0">
      <AgentsClient
        agents={agents}
        channelDefaults={channelDefaults}
        defaultShowInactive={defaultShowInactive}
        settingsButton={
          <AgentSettingsButton defaults={channelDefaults} agents={activeAgents} />
        }
      />
    </PageContainer>
  );
}

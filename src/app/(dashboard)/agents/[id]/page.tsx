import { notFound } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AgentPromptEditor } from '@/components/agents/agent-prompt-editor'
import { AgentToolsCard } from '@/components/agents/agent-tools-card'
import { AgentWorkflowTools } from '@/components/agents/agent-workflow-tools'
import { AgentPartnersManager } from '@/components/agents/agent-partners-manager'
import { getAgentById, getActiveAgents } from '../actions'
import { getToolPickerData } from '../_actions/tools'
import { getAgentWorkflows, getAvailableWorkflowsForAgent } from '../_actions/workflows'
import { listAgentPartners } from '../_actions/partners'

type Props = { params: Promise<{ id: string }> }

/**
 * "Prompt & Actions" — the agent's primary section (landing page when you click
 * the agent in the sidebar). The system prompt plus everything the agent can
 * DO: call tools, run workflows, and delegate to other agents. "Test Your Bot"
 * stays visible on the right (rendered by the layout).
 */
export default async function AgentPromptActionsPage({ params }: Props) {
  const { id } = await params
  const [agent, toolPickerData, attachedWorkflows, availableWorkflows, partners, activeAgents] =
    await Promise.all([
      getAgentById(id),
      getToolPickerData(),
      getAgentWorkflows(id),
      getAvailableWorkflowsForAgent(id),
      listAgentPartners(id),
      getActiveAgents(),
    ])
  if (!agent) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt</CardTitle>
          <CardDescription>
            How the agent should behave. Saving creates a draft version.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentPromptEditor agentId={agent.id} initialPrompt={agent.system_prompt} />
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
          <CardDescription>
            Functions the agent can call, workflows it can run, and other agents
            it can delegate to.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-text-primary">Tools</h3>
            <AgentToolsCard
              agentId={agent.id}
              toolPickerData={toolPickerData}
              initialToolIds={agent.tool_ids}
            />
          </section>

          <div className="border-t border-border pt-6">
            <AgentWorkflowTools
              agentId={agent.id}
              initialAttached={attachedWorkflows}
              initialAvailable={availableWorkflows}
            />
          </div>

          <section className="space-y-2 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-text-primary">Partner agents (delegation)</h3>
            <AgentPartnersManager
              agentId={agent.id}
              initialPartners={partners}
              availableAgents={activeAgents.map((a) => ({ id: a.id, name: a.name, slug: a.slug }))}
            />
          </section>
        </CardContent>
      </Card>
    </div>
  )
}

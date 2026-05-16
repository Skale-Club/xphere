import { AgentForm } from '@/components/agents/agent-form'
import { getToolPickerData } from '../actions'

export default async function NewAgentPage() {
  const toolPickerData = await getToolPickerData()
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <h1 className="text-lg font-semibold">New agent</h1>
        <p className="text-sm text-muted-foreground">
          Create a new chat agent for your organization.
        </p>
      </div>
      <AgentForm mode="create" toolPickerData={toolPickerData} />
    </div>
  )
}

import { redirect, notFound } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getWorkflow } from '../_actions/workflows'
import { getActiveIntegrations } from '@/lib/flows/active-integrations'
import { FlowCanvas } from '@/components/flows/flow-canvas'

export default async function FlowEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/login')

  const { id } = await params
  const [result, activeIntegrations] = await Promise.all([
    getWorkflow(id),
    getActiveIntegrations(),
  ])
  if (!result.ok) notFound()

  return (
    <div className="h-[calc(100vh-0px)] flex flex-col">
      <FlowCanvas
        workflowId={result.data.id}
        workflowName={result.data.name}
        initialDefinition={result.data.definition}
        activeIntegrations={activeIntegrations}
      />
    </div>
  )
}

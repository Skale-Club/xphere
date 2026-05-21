import { redirect, notFound } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getWorkflow } from '../_actions/workflows'
import { getActiveIntegrations } from '@/lib/flows/active-integrations'
import { FlowCanvas } from '@/components/flows/flow-canvas'
import { DesktopOnly } from '@/components/layout/desktop-only'

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
    <DesktopOnly message="The visual flow editor uses drag-and-drop and a large canvas that's not designed for small touch screens.">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <FlowCanvas
          workflowId={result.data.id}
          workflowName={result.data.name}
          isActive={result.data.is_active ?? false}
          initialDefinition={result.data.definition}
          activeIntegrations={activeIntegrations}
        />
      </div>
    </DesktopOnly>
  )
}

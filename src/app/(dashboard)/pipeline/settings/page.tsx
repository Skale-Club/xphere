import { getPipelines, getStages } from '../actions'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import { PipelineSettingsClient } from '@/components/pipeline/pipeline-settings-client'

interface PipelineSettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PipelineSettingsPage({ searchParams }: PipelineSettingsPageProps) {
  const sp = await searchParams
  const requested = typeof sp.pipeline === 'string' ? sp.pipeline : undefined

  const pipelines = await getPipelines()
  const active =
    pipelines.find((p) => p.id === requested) ??
    pipelines.find((p) => p.is_default) ??
    pipelines[0] ??
    null

  const [stages, customFieldsResult] = await Promise.all([
    active ? getStages(active.id) : Promise.resolve([]),
    getDefinitions({ entity: 'opportunity' }),
  ])

  const customFields = customFieldsResult.ok
    ? customFieldsResult.data.map((f) => ({ key: `custom::${f.id}`, label: f.label }))
    : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <PipelineSettingsClient
        pipelines={pipelines}
        activeId={active?.id ?? null}
        stages={stages}
        activePipelineCardFields={(active?.card_fields as string[] | undefined) ?? ['contact_name', 'value', 'days_in_stage']}
        customFields={customFields}
      />
    </div>
  )
}

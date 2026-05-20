import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getPipelines, getStages } from '../actions'
import { PipelineSettingsClient } from '@/components/pipeline/pipeline-settings-client'
import { Button } from '@/components/ui/button'

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
  const stages = active ? await getStages(active.id) : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="animate-fade-in flex items-center justify-end gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pipeline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to board
          </Link>
        </Button>
      </div>

      <PipelineSettingsClient
        pipelines={pipelines}
        activeId={active?.id ?? null}
        stages={stages}
      />
    </div>
  )
}

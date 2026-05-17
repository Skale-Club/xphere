import Link from 'next/link'
import { Settings, ArrowLeft } from 'lucide-react'

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
      <div className="animate-fade-in flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          <Settings className="h-3.5 w-3.5 text-accent" />
          <span>Pipeline settings</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-text-primary">
              Manage pipelines
            </h1>
            <p className="mt-1 text-[14px] text-text-secondary">
              Create pipelines, rename stages, pick colours, and mark won/lost stages.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/pipeline">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to board
            </Link>
          </Button>
        </div>
      </div>

      <PipelineSettingsClient
        pipelines={pipelines}
        activeId={active?.id ?? null}
        stages={stages}
      />
    </div>
  )
}

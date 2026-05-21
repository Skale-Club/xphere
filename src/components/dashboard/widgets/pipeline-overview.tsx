import Link from 'next/link'
import { TrendingUp } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { WidgetCard } from '@/components/dashboard/widget-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import { formatCurrency } from '@/lib/pipeline/format'

interface StageRow {
  id: string
  name: string
  color: string
  count: number
  value: number
  pipelineId: string
}

/**
 * Active pipeline overview: per-stage horizontal bars with count + total
 * value, plus a footer aggregate. Queries pipelines + opportunities
 * inline (no shared fetch).
 */
export async function PipelineOverview() {
  let stages: StageRow[] = []
  let totalActiveCount = 0
  let totalActiveValue = 0

  try {
    const supabase = await createClient()

    // Find default pipeline (or the first one).
    const { data: pipeline } = await supabase
      .from('pipelines')
      .select('id, name')
      .order('is_default', { ascending: false })
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (pipeline) {
      const { data: stageRows } = await supabase
        .from('pipeline_stages')
        .select('id, name, color, position, is_won, is_lost')
        .eq('pipeline_id', pipeline.id)
        .order('position', { ascending: true })

      const { data: opps } = await supabase
        .from('opportunities')
        .select('stage_id, value, status')
        .eq('pipeline_id', pipeline.id)

      const byStage = new Map<string, { count: number; value: number }>()
      for (const o of opps ?? []) {
        // Only count active (open) deals into the per-stage active totals.
        // Stages flagged is_won show won-deals-this-month separately.
        if (o.status === 'open') {
          const cur = byStage.get(o.stage_id) ?? { count: 0, value: 0 }
          cur.count += 1
          cur.value += Number(o.value) || 0
          byStage.set(o.stage_id, cur)
        }
      }

      stages = (stageRows ?? []).map((s) => {
        const m = byStage.get(s.id) ?? { count: 0, value: 0 }
        return {
          id: s.id,
          name: s.name,
          color: s.color,
          count: m.count,
          value: m.value,
          pipelineId: pipeline.id,
        }
      })

      for (const m of byStage.values()) {
        totalActiveCount += m.count
        totalActiveValue += m.value
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:pipeline-overview]', err)
  }

  // Empty state | no pipeline configured OR every stage is empty
  if (stages.length === 0) {
    return (
      <WidgetCard title="Active pipeline" icon={TrendingUp} href="/pipeline" hrefLabel="View board">
        <WidgetEmpty
          icon={TrendingUp}
          title="No pipeline configured"
          description="Create a pipeline and start tracking deals by stage."
          cta={{ label: 'Open pipeline', href: '/pipeline' }}
        />
      </WidgetCard>
    )
  }

  const maxStageValue = Math.max(1, ...stages.map((s) => s.value))

  return (
    <WidgetCard title="Active pipeline" icon={TrendingUp} href="/pipeline" hrefLabel="View board">
      <div className="flex flex-col gap-2.5">
        {stages.map((s) => {
          const pct = (s.value / maxStageValue) * 100
          return (
            <Link
              key={s.id}
              href={`/pipeline?stage=${s.id}`}
              className="group block rounded-[8px] px-2 py-1.5 transition-colors hover:bg-bg-tertiary"
            >
              <div className="flex items-center justify-between text-[12px]">
                <span className="inline-flex items-center gap-1.5 text-text-secondary">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="font-medium text-text-primary">{s.name}</span>
                  <span className="text-text-tertiary">· {s.count} {s.count === 1 ? 'deal' : 'deals'}</span>
                </span>
                <span className="tabular text-text-tertiary">{formatCurrency(s.value)}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: s.color,
                    minWidth: s.value > 0 ? '4px' : '0',
                  }}
                />
              </div>
            </Link>
          )
        })}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-3 text-[12px] text-text-tertiary">
        <span>
          <span className="font-medium text-text-secondary">{totalActiveCount}</span> active deals
        </span>
        <span className="tabular">
          <span className="font-medium text-text-secondary">{formatCurrency(totalActiveValue)}</span> total value
        </span>
      </div>
    </WidgetCard>
  )
}

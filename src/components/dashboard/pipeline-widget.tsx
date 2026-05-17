import Link from 'next/link'
import { TrendingUp, ArrowRight, Trophy, Frown } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getPipelineMetrics } from '@/app/(dashboard)/pipeline/actions'
import { formatCurrency } from '@/lib/pipeline/format'

/**
 * Home-dashboard widget summarising the active sales pipeline.
 * Server component — fetches metrics inline.
 */
export async function PipelineWidget() {
  const m = await getPipelineMetrics()

  if (m.perStage.length === 0 && m.totalOpenValue === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-accent" />
            <span>Pipeline</span>
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/pipeline">
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-[10px] border border-dashed border-border-subtle p-6 text-center">
            <p className="text-[12.5px] text-text-secondary">
              No opportunities yet. Create your first deal in the pipeline.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/pipeline">
                Open pipeline <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const maxStageValue = Math.max(1, ...m.perStage.map((s) => s.value))
  const conversionPct = Math.round(m.conversionRate * 100)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-accent" />
          <span>Pipeline</span>
          <Badge variant="default">This month</Badge>
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/pipeline">
            Open <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Tile
            label="Open value"
            value={formatCurrency(m.totalOpenValue)}
          />
          <Tile
            label="Won"
            value={`${m.wonThisMonth.count}`}
            sub={formatCurrency(m.wonThisMonth.value)}
            icon={Trophy}
            iconClass="text-emerald-400"
          />
          <Tile
            label="Conversion"
            value={`${conversionPct}%`}
            sub={`${m.lostThisMonth.count} lost`}
            icon={Frown}
            iconClass="text-rose-400"
          />
        </div>

        <div className="space-y-1.5">
          {m.perStage.map((s) => {
            const pct = (s.value / maxStageValue) * 100
            return (
              <div key={s.stage_id} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="inline-flex items-center gap-1.5 text-text-secondary">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.name}
                    <span className="text-text-tertiary">({s.count})</span>
                  </span>
                  <span className="tabular-nums text-text-tertiary">
                    {formatCurrency(s.value)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: s.color,
                      minWidth: s.value > 0 ? '4px' : '0',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function Tile({
  label,
  value,
  sub,
  icon: Icon,
  iconClass,
}: {
  label: string
  value: string
  sub?: string
  icon?: React.ComponentType<{ className?: string }>
  iconClass?: string
}) {
  return (
    <div className="rounded-[10px] border border-border-subtle bg-bg-secondary px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-text-tertiary">
        {Icon && <Icon className={`h-3 w-3 ${iconClass ?? ''}`} />}
        <span>{label}</span>
      </div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-text-primary">{value}</div>
      {sub && <div className="text-[10.5px] text-text-tertiary tabular-nums">{sub}</div>}
    </div>
  )
}

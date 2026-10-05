import { cn } from '@/lib/utils'

/** "312 / 1,000 points this month" pill with a thin usage bar. */
export function QuotaMeter({ used, limit, className }: { used: number; limit: number; className?: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100
  const tone = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent'
  return (
    <div
      className={cn('flex min-w-[180px] flex-col gap-1 rounded-lg border border-border-subtle px-3 py-1.5', className)}
      title="Scan points used this month. Each grid point of a scan costs one point."
    >
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-text-secondary">Points this month</span>
        <span className="font-medium tabular-nums text-text-primary">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-bg-tertiary">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

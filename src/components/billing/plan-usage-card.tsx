// Server component: shows the org's current plan, status, and usage against the
// plan's limits. No interactivity — rendered straight into Settings → Billing.
import { Gauge } from 'lucide-react'

export interface UsageItem {
  label: string
  count: number
  /** null = unlimited */
  limit: number | null
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  expired: 'Expired',
  none: 'No plan',
}

function UsageRow({ item }: { item: UsageItem }) {
  const pct =
    item.limit && item.limit > 0 ? Math.min(100, Math.round((item.count / item.limit) * 100)) : 0
  const over = item.limit != null && item.count >= item.limit
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{item.label}</span>
        <span className="tabular-nums text-text-tertiary">
          {item.count.toLocaleString()} / {item.limit == null ? '∞' : item.limit.toLocaleString()}
        </span>
      </div>
      {item.limit != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className={`h-full rounded-full ${over ? 'bg-amber-500' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function PlanUsageCard({
  planName,
  status,
  trialEndsAt,
  items,
}: {
  planName: string | null
  status: string
  trialEndsAt: string | null
  items: UsageItem[]
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Plan &amp; usage</h2>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-lg font-semibold text-text-primary">{planName ?? 'No plan'}</span>
        <span className="text-xs text-text-tertiary">· {STATUS_LABEL[status] ?? status}</span>
      </div>
      {status === 'trialing' && trialEndsAt && (
        <p className="-mt-2 text-xs text-text-tertiary">
          Trial ends{' '}
          {new Date(trialEndsAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </p>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <UsageRow key={item.label} item={item} />
        ))}
      </div>
    </div>
  )
}

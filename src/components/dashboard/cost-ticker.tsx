// src/components/dashboard/cost-ticker.tsx
// Phase 40 OBS-05: Per-org cost ticker for /dashboard.
// Server component | fetches data via observability server action.
// Shows 1h / 24h / 7d cost totals with daily cap % and alert badge at ≥80%.

import { getOrgCostTicker } from '@/lib/agent-runtime/observability'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return '<$0.001'
  return `$${usd.toFixed(3)}`
}

export async function CostTicker() {
  const ticker = await getOrgCostTicker()

  // Return null if no org or no data | widget simply disappears
  if (!ticker) return null

  const pct = Math.round(ticker.pctOf24hCap)
  const capFormatted = `$${ticker.dailyCapUsd.toFixed(2)}`

  return (
    <Card className={ticker.isAlertLevel ? 'border-orange-400/50' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Agent Cost
          </CardTitle>
          {ticker.isAlertLevel && (
            <Badge
              variant="outline"
              className="bg-orange-500/10 text-orange-600 border-orange-400/50 text-[10px]"
            >
              ⚠ {pct}% of daily cap
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Last 1h</p>
            <p className="text-xl font-bold tracking-tight">{formatCost(ticker.cost1hUsd)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Last 24h</p>
            <p className="text-xl font-bold tracking-tight">{formatCost(ticker.cost24hUsd)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Last 7d</p>
            <p className="text-xl font-bold tracking-tight">{formatCost(ticker.cost7dUsd)}</p>
          </div>
        </div>

        {/* Progress bar | % of daily cap consumed */}
        <div className="mt-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Daily cap: {capFormatted}</span>
            <span>{pct}% used</span>
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                ticker.isAlertLevel ? 'bg-orange-500' : 'bg-primary'
              }`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

import { Building2, Users, Contact2, Phone, MessageSquare, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { PlatformDashboard } from '@/app/(admin)/admin/_actions/get-platform-dashboard'

function delta(current: number, previous: number) {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  return pct
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  sub?: string
  trend?: number | null
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-text-tertiary" />
            <span className="text-sm text-text-secondary">{label}</span>
          </div>
          {trend != null && (
            <span className={`text-xs font-medium ${trend >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
              {trend >= 0 ? '+' : ''}{trend}%
            </span>
          )}
        </div>
        <p className="text-2xl font-semibold text-text-primary tabular-nums leading-none">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {sub && <p className="text-xs text-text-tertiary mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function PlatformKpiRow({ kpis, new_orgs_30d }: { kpis: PlatformDashboard['kpis']; new_orgs_30d: number }) {
  const callTrend = delta(kpis.calls_30d, kpis.calls_prev_30d)
  const convTrend = delta(kpis.conversations_30d, kpis.conversations_prev_30d)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      <KpiCard icon={Building2} label="Organizations" value={kpis.total_orgs} sub={`${kpis.active_orgs} active · +${new_orgs_30d} this month`} />
      <KpiCard icon={Users} label="Members" value={kpis.total_members} />
      <KpiCard icon={Contact2} label="Contacts" value={kpis.total_contacts} />
      <KpiCard icon={Phone} label="Calls (30d)" value={kpis.calls_30d} trend={callTrend} />
      <KpiCard icon={MessageSquare} label="Conversations (30d)" value={kpis.conversations_30d} trend={convTrend} />
      <KpiCard icon={TrendingUp} label="Active rate" value={`${kpis.total_orgs > 0 ? Math.round((kpis.active_orgs / kpis.total_orgs) * 100) : 0}%`} sub={`${kpis.active_orgs}/${kpis.total_orgs} orgs active`} />
    </div>
  )
}

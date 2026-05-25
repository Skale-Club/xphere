import { Suspense } from 'react'
import { Globe, MonitorSmartphone, TrendingUp, Activity } from 'lucide-react'
import { format } from 'date-fns'
import { getTrafficOverview } from './_actions/get-traffic-overview'

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <p className="text-[12px] font-medium text-text-tertiary uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-primary tabular-nums">{value.toLocaleString()}</p>
      {sub && <p className="mt-0.5 text-[11px] text-text-tertiary">{sub}</p>}
    </div>
  )
}

async function TrafficContent() {
  const data = await getTrafficOverview()

  const adoptionPct = data.total_setups > 0
    ? Math.round((data.verified_setups / data.total_setups) * 100)
    : 0

  return (
    <div className="space-y-8">
      {/* KPI row */}
      <div className="grid grid-cols-5 gap-4">
        <MetricCard label="Total Setups" value={data.total_setups} sub={`${data.verified_setups} verified (${adoptionPct}%)`} />
        <MetricCard label="Pageviews (30d)" value={data.total_pageviews_30d} />
        <MetricCard label="Sessions (30d)" value={data.total_sessions_30d} />
        <MetricCard label="Visitors (30d)" value={data.total_visitors_30d} />
        <MetricCard label="Adoption Rate" value={`${adoptionPct}%`} sub="verified / total setups" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Top orgs table */}
        <div className="col-span-2 rounded-lg border border-border bg-bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-text-tertiary" />
            <h2 className="text-[13px] font-semibold text-text-primary">Top Orgs by Traffic</h2>
            <span className="text-[11px] text-text-tertiary ml-auto">Last 30 days</span>
          </div>
          {data.top_orgs.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-text-tertiary">No traffic data yet</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-medium text-text-tertiary">Organization</th>
                  <th className="px-4 py-2 text-right font-medium text-text-tertiary">Sessions</th>
                  <th className="px-4 py-2 text-right font-medium text-text-tertiary">Pageviews</th>
                  <th className="px-4 py-2 text-right font-medium text-text-tertiary">Last event</th>
                </tr>
              </thead>
              <tbody>
                {data.top_orgs.map((org) => (
                  <tr key={org.org_id} className="border-b border-border last:border-0 hover:bg-bg-tertiary/50">
                    <td className="px-4 py-2.5 text-text-primary font-medium">{org.org_name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{org.total_sessions.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{org.total_pageviews.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-text-tertiary">
                      {org.last_event_at ? format(new Date(org.last_event_at), 'MMM d, HH:mm') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent sessions */}
        <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Activity className="h-4 w-4 text-text-tertiary" />
            <h2 className="text-[13px] font-semibold text-text-primary">Recent Sessions</h2>
          </div>
          {data.recent_sessions.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-text-tertiary">No sessions yet</div>
          ) : (
            <div className="divide-y divide-border">
              {data.recent_sessions.map((s) => (
                <div key={s.id} className="px-4 py-2.5 hover:bg-bg-tertiary/50">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12px] font-medium text-text-primary truncate max-w-[120px]">{s.org_name}</span>
                    <span className="text-[11px] text-text-tertiary">{format(new Date(s.started_at), 'HH:mm')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                    <Globe className="h-3 w-3 shrink-0" />
                    <span>{s.country_code ?? '??'}</span>
                    <MonitorSmartphone className="h-3 w-3 shrink-0" />
                    <span>{s.device_type ?? 'unknown'}</span>
                    {s.utm_source && (
                      <>
                        <span>·</span>
                        <span className="text-accent">{s.utm_source}</span>
                      </>
                    )}
                    <span className="ml-auto">{s.pageview_count} pv</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TrafficSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="grid grid-cols-5 gap-4">
        {['m1', 'm2', 'm3', 'm4', 'm5'].map((k) => (
          <div key={k} className="h-20 rounded-lg bg-bg-tertiary" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 h-64 rounded-lg bg-bg-tertiary" />
        <div className="h-64 rounded-lg bg-bg-tertiary" />
      </div>
    </div>
  )
}

export default function AdminTrafficPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Traffic Overview</h1>
        <p className="text-sm text-text-secondary mt-1">Platform-wide web traffic analytics across all organizations</p>
      </div>
      <Suspense fallback={<TrafficSkeleton />}>
        <TrafficContent />
      </Suspense>
    </div>
  )
}

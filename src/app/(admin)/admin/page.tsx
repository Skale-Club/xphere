import { Suspense } from 'react'
import { getPlatformDashboard } from './_actions/get-platform-dashboard'
import { PlatformKpiRow } from '@/components/admin/dashboard/platform-kpi-row'
import { RecentOrgsWidget } from '@/components/admin/dashboard/recent-orgs-widget'
import { TopOrgsWidget } from '@/components/admin/dashboard/top-orgs-widget'
import { FlagAdoptionWidget } from '@/components/admin/dashboard/flag-adoption-widget'
import { LpStatusWidget } from '@/components/admin/dashboard/lp-status-widget'
import { WorkflowStatsWidget } from '@/components/admin/dashboard/workflow-stats-widget'
import { CampaignPulseWidget } from '@/components/admin/dashboard/campaign-pulse-widget'

async function DashboardContent() {
  const data = await getPlatformDashboard()
  return (
    <div className="space-y-8">
      <PlatformKpiRow kpis={data.kpis} new_orgs_30d={data.kpis.new_orgs_30d} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <RecentOrgsWidget orgs={data.recent_orgs} />
          <TopOrgsWidget orgs={data.top_orgs} />
        </div>
        <div className="lg:col-span-1 space-y-6">
          <LpStatusWidget snapshot={data.seo_snapshot} />
          <FlagAdoptionWidget flags={data.flag_adoption} />
          <WorkflowStatsWidget stats={data.workflow_stats} />
          <CampaignPulseWidget activeCampaigns={data.active_campaigns} />
        </div>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-bg-tertiary" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-48 rounded-lg bg-bg-tertiary" />
          <div className="h-64 rounded-lg bg-bg-tertiary" />
        </div>
        <div className="lg:col-span-1 space-y-6">
          <div className="h-40 rounded-lg bg-bg-tertiary" />
          <div className="h-32 rounded-lg bg-bg-tertiary" />
          <div className="h-32 rounded-lg bg-bg-tertiary" />
        </div>
      </div>
    </div>
  )
}

export default function AdminOverviewPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Platform Overview</h1>
        <p className="text-sm text-text-secondary mt-1">Cross-platform metrics and activity at a glance</p>
      </div>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  )
}

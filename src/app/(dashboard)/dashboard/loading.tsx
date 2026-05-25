import {
  GridSkeleton,
  HeroSkeleton,
  MetricSkeleton,
  PanelSkeleton,
} from '@/components/dashboard/widget-skeleton'
import { PageContainer } from '@/components/layout/page-header'

/**
 * Dashboard route-level loading skeleton.
 *
 * This file intentionally lives at app/(dashboard)/dashboard/loading.tsx
 * so it takes precedence over the generic (dashboard)/loading.tsx for this
 * route. It mirrors the exact layout of dashboard/page.tsx so users see a
 * single consistent skeleton instead of two different ones flashing in
 * sequence.
 */
export default function DashboardLoading() {
  return (
    <PageContainer>
      {/* Hero */}
      <HeroSkeleton />

      {/* Row 1 — 4 metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricSkeleton />
        <MetricSkeleton />
        <MetricSkeleton />
        <MetricSkeleton />
      </div>

      {/* Row 2 — large panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PanelSkeleton rows={5} />
        <PanelSkeleton rows={5} />
      </div>

      {/* Row 3 — medium panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <PanelSkeleton rows={4} />
        <GridSkeleton tiles={6} />
        <PanelSkeleton rows={5} />
      </div>

      {/* Row 4 — top companies */}
      <div className="grid grid-cols-1 gap-4">
        <PanelSkeleton rows={5} />
      </div>
    </PageContainer>
  )
}

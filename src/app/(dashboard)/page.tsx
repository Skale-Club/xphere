import { Suspense } from 'react'
import { Sparkles } from 'lucide-react'

import { PageContainer } from '@/components/layout/page-header'
import { WidgetErrorBoundary } from '@/components/dashboard/widget-error-boundary'
import { WidgetError } from '@/components/dashboard/widget-error'
import {
  GridSkeleton,
  HeroSkeleton,
  MetricSkeleton,
  PanelSkeleton,
} from '@/components/dashboard/widget-skeleton'

export const dynamic = 'force-dynamic'

/**
 * Home dashboard orchestrator.
 *
 * Architecture (SEED-012 — see `.planning/seeds/SEED-012-complete-dashboard.md`):
 *
 * - Each widget is its own Server Component file under
 *   `src/components/dashboard/widgets/`.
 * - Each widget is wrapped at THIS layer in
 *   `<WidgetErrorBoundary><Suspense fallback={...}>...</Suspense></WidgetErrorBoundary>`.
 * - No `Promise.all` and no shared data fetch — every widget queries its own
 *   slice of data. Killing any single query leaves the rest of the page
 *   intact.
 *
 * This file intentionally stays declarative — it composes the grid, the
 * boundaries, the skeletons, the empty/error fallbacks. The widget files
 * own the rendering.
 *
 * Wave D1 ships only the skeleton scaffolding (this file + the wrappers).
 * Subsequent waves replace each placeholder with a real Server Component.
 */
export default function DashboardPage() {
  return (
    <PageContainer>
      {/* Hero — greeting + cost ticker + workspace status */}
      <WidgetErrorBoundary name="hero" fallback={<WidgetError title="Overview" />}>
        <Suspense fallback={<HeroSkeleton />}>
          <PlaceholderHero />
        </Suspense>
      </WidgetErrorBoundary>

      {/* Row 1 — 4 metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <WidgetErrorBoundary name="metric-conversations" fallback={<WidgetError title="Conversations" />}>
          <Suspense fallback={<MetricSkeleton />}>
            <PlaceholderMetric label="Open conversations" />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="metric-calls" fallback={<WidgetError title="Calls" />}>
          <Suspense fallback={<MetricSkeleton />}>
            <PlaceholderMetric label="Calls today" />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="metric-deals" fallback={<WidgetError title="Deals" />}>
          <Suspense fallback={<MetricSkeleton />}>
            <PlaceholderMetric label="Deals won (mo)" />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="metric-rating" fallback={<WidgetError title="Reviews" />}>
          <Suspense fallback={<MetricSkeleton />}>
            <PlaceholderMetric label="Avg rating" />
          </Suspense>
        </WidgetErrorBoundary>
      </div>

      {/* Row 2 — large panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetErrorBoundary name="recent-conversations" fallback={<WidgetError title="Recent conversations" />}>
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <PlaceholderPanel label="Recent conversations" />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="pipeline-overview" fallback={<WidgetError title="Pipeline overview" />}>
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <PlaceholderPanel label="Pipeline overview" />
          </Suspense>
        </WidgetErrorBoundary>
      </div>

      {/* Row 3 — medium panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <WidgetErrorBoundary name="recent-calls" fallback={<WidgetError title="Recent calls" />}>
          <Suspense fallback={<PanelSkeleton rows={4} />}>
            <PlaceholderPanel label="Recent calls" />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="integrations-status" fallback={<WidgetError title="Integrations" />}>
          <Suspense fallback={<GridSkeleton tiles={6} />}>
            <PlaceholderPanel label="Integrations" />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="activity-snapshot" fallback={<WidgetError title="Today" />}>
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <PlaceholderPanel label="Today's activity" />
          </Suspense>
        </WidgetErrorBoundary>
      </div>

      {/* Row 4 — activity feed */}
      <WidgetErrorBoundary name="activity-feed" fallback={<WidgetError title="Activity" />}>
        <Suspense fallback={<PanelSkeleton rows={8} />}>
          <PlaceholderPanel label="Activity feed" />
        </Suspense>
      </WidgetErrorBoundary>
    </PageContainer>
  )
}

// ─── Placeholder components (replaced by real widgets in subsequent waves) ──

function PlaceholderHero() {
  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-6 shadow-elevation-sm">
      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span>Overview</span>
      </div>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-text-primary">
        Dashboard
      </h1>
      <p className="mt-1 text-[13px] text-text-secondary">
        Hero widget placeholder — wired in wave D2.
      </p>
    </div>
  )
}

function PlaceholderMetric({ label }: { label: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm">
      <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
        {label}
      </div>
      <div className="mt-2 text-[20px] font-semibold tracking-tight text-text-tertiary">
        Loading…
      </div>
    </div>
  )
}

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm">
      <div className="text-[13.5px] font-medium text-text-primary">{label}</div>
      <div className="mt-2 text-[12.5px] text-text-tertiary">
        Loading…
      </div>
    </div>
  )
}

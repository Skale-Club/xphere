import { Suspense } from 'react'
import { cookies } from 'next/headers'

import { createClient, getUser } from '@/lib/supabase/server'
import { PageContainer } from '@/components/layout/page-header'
import { WidgetErrorBoundary } from '@/components/dashboard/widget-error-boundary'
import { WidgetError } from '@/components/dashboard/widget-error'
import {
  GridSkeleton,
  HeroSkeleton,
  MetricSkeleton,
  PanelSkeleton,
} from '@/components/dashboard/widget-skeleton'
import { HeroSection } from '@/components/dashboard/widgets/hero-section'
import { MetricOpenConversations } from '@/components/dashboard/widgets/metric-open-conversations'
import { MetricCallsToday } from '@/components/dashboard/widgets/metric-calls-today'
import { MetricDealsWon } from '@/components/dashboard/widgets/metric-deals-won'
import { MetricAvgRating } from '@/components/dashboard/widgets/metric-avg-rating'
import { RecentConversations } from '@/components/dashboard/widgets/recent-conversations'
import { PipelineOverview } from '@/components/dashboard/widgets/pipeline-overview'
import { RecentCalls } from '@/components/dashboard/widgets/recent-calls'
import { IntegrationsStatus } from '@/components/dashboard/widgets/integrations-status'
import { ActivitySnapshot } from '@/components/dashboard/widgets/activity-snapshot'
import { TopCompanies } from '@/components/dashboard/widgets/top-companies'
import { WelcomeWizard } from '@/components/dashboard/welcome-wizard'

export const dynamic = 'force-dynamic'

interface FreshOrgSignals {
  isFresh: boolean
  hasIntegration: boolean
  hasContacts: boolean
  hasAgent: boolean
  hasDeals: boolean
  hasReviews: boolean
}

/**
 * Detect whether the active org has ANY meaningful data yet. Sequential
 * (no Promise.all) | each call is a head:exact count, very cheap. Any
 * failure short-circuits to "not fresh" so the user sees the normal
 * dashboard rather than getting locked in the wizard.
 */
async function detectFreshOrg(): Promise<FreshOrgSignals> {
  const fallback: FreshOrgSignals = {
    isFresh: false,
    hasIntegration: true,
    hasContacts: true,
    hasAgent: true,
    hasDeals: true,
    hasReviews: true,
  }
  try {
    const supabase = await createClient()

    const { count: conv } = await supabase.from('conversations').select('id', { count: 'exact', head: true })
    const { count: contacts } = await supabase.from('contacts').select('id', { count: 'exact', head: true })
    const { count: calls } = await supabase.from('call_logs').select('id', { count: 'exact', head: true })
    const { count: deals } = await supabase.from('opportunities').select('id', { count: 'exact', head: true })
    const { count: ints } = await supabase
      .from('integrations')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    const { count: evos } = await supabase
      .from('evolution_instances')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    const { count: agents } = await supabase.from('agents').select('id', { count: 'exact', head: true })
    const { count: gbps } = await supabase
      .from('google_business_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)

    const hasConversations = (conv ?? 0) > 0
    const hasContacts = (contacts ?? 0) > 0
    const hasCalls = (calls ?? 0) > 0
    const hasDeals = (deals ?? 0) > 0
    const hasIntegration = (ints ?? 0) > 0 || (evos ?? 0) > 0
    const hasAgent = (agents ?? 0) > 0
    const hasReviews = (gbps ?? 0) > 0

    return {
      isFresh:
        !hasConversations &&
        !hasContacts &&
        !hasCalls &&
        !hasDeals &&
        !hasIntegration,
      hasIntegration,
      hasContacts,
      hasAgent,
      hasDeals,
      hasReviews,
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:fresh-org] detection failed', err)
    return fallback
  }
}

/**
 * Home dashboard orchestrator.
 *
 * Architecture (SEED-012 | see `.planning/seeds/SEED-012-complete-dashboard.md`):
 *
 * - Each widget is its own Server Component file under
 *   `src/components/dashboard/widgets/`.
 * - Each widget is wrapped at THIS layer in
 *   `<WidgetErrorBoundary><Suspense fallback={...}>...</Suspense></WidgetErrorBoundary>`.
 * - No `Promise.all` and no shared data fetch | every widget queries its
 *   own slice of data. Killing any single query leaves the rest of the
 *   page intact.
 * - Fresh-org detection (above) decides whether to show the WelcomeWizard
 *   instead of the normal dashboard for first-session users; failure of
 *   that detection falls back to the normal dashboard.
 *
 * Reads the `dashboard_welcome_dismissed=1` cookie or `?welcome=skip`
 * search-param hint to permanently switch the user off the wizard.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ welcome?: string }>
}) {
  // Honour an explicit dismiss either via cookie or query-param.
  const cookieStore = await cookies()
  const dismissedCookie = cookieStore.get('dashboard_welcome_dismissed')?.value === '1'
  const sp = (await searchParams) ?? {}
  const dismissedNow = sp.welcome === 'skip'

  let signals: FreshOrgSignals | null = null
  if (!dismissedCookie && !dismissedNow) {
    signals = await detectFreshOrg()
  }

  if (signals?.isFresh) {
    let userName = 'there'
    try {
      const user = await getUser()
      if (user?.user_metadata?.full_name && typeof user.user_metadata.full_name === 'string') {
        userName = user.user_metadata.full_name.trim().split(/\s+/)[0]
      } else if (user?.email) {
        userName = user.email.split('@')[0]
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[dashboard:welcome] getUser failed', err)
    }
    return (
      <WelcomeWizard
        userName={userName}
        hasIntegration={signals.hasIntegration}
        hasContacts={signals.hasContacts}
        hasAgent={signals.hasAgent}
        hasDeals={signals.hasDeals}
        hasReviews={signals.hasReviews}
      />
    )
  }

  return (
    <PageContainer>
      {/* Hero | greeting + cost ticker + workspace status */}
      <WidgetErrorBoundary name="hero" fallback={<WidgetError title="Overview" />}>
        <Suspense fallback={<HeroSkeleton />}>
          <HeroSection />
        </Suspense>
      </WidgetErrorBoundary>

      {/* Row 1 | 4 metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <WidgetErrorBoundary name="metric-conversations" fallback={<WidgetError title="Conversations" />}>
          <Suspense fallback={<MetricSkeleton />}>
            <MetricOpenConversations />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="metric-calls" fallback={<WidgetError title="Calls" />}>
          <Suspense fallback={<MetricSkeleton />}>
            <MetricCallsToday />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="metric-deals" fallback={<WidgetError title="Deals" />}>
          <Suspense fallback={<MetricSkeleton />}>
            <MetricDealsWon />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="metric-rating" fallback={<WidgetError title="Reviews" />}>
          <Suspense fallback={<MetricSkeleton />}>
            <MetricAvgRating />
          </Suspense>
        </WidgetErrorBoundary>
      </div>

      {/* Row 2 | large panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WidgetErrorBoundary name="recent-conversations" fallback={<WidgetError title="Recent conversations" />}>
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <RecentConversations />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="pipeline-overview" fallback={<WidgetError title="Pipeline overview" />}>
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <PipelineOverview />
          </Suspense>
        </WidgetErrorBoundary>
      </div>

      {/* Row 3 | medium panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <WidgetErrorBoundary name="recent-calls" fallback={<WidgetError title="Recent calls" />}>
          <Suspense fallback={<PanelSkeleton rows={4} />}>
            <RecentCalls />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="integrations-status" fallback={<WidgetError title="Integrations" />}>
          <Suspense fallback={<GridSkeleton tiles={6} />}>
            <IntegrationsStatus />
          </Suspense>
        </WidgetErrorBoundary>
        <WidgetErrorBoundary name="activity-snapshot" fallback={<WidgetError title="Today" />}>
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <ActivitySnapshot />
          </Suspense>
        </WidgetErrorBoundary>
      </div>

      {/* Row 4 | Top Companies (ACC-18) */}
      <div className="grid grid-cols-1 gap-4">
        <WidgetErrorBoundary name="top-companies" fallback={<WidgetError title="Top Companies" />}>
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <TopCompanies />
          </Suspense>
        </WidgetErrorBoundary>
      </div>

    </PageContainer>
  )
}

import { Suspense } from 'react'
import Link from 'next/link'
import {
  Phone,
  Bot,
  MessageSquare,
  DollarSign,
  ArrowRight,
  Plus,
  Sparkles,
  Users,
  Zap,
  PhoneCall,
  Star,
} from 'lucide-react'
import { createClient, getUser } from '@/lib/supabase/server'
import { getDashboardMetrics } from './calls/actions'
import { getOrgCostTicker } from '@/lib/agent-runtime/observability'
import { VapiSetupBanner } from '@/components/dashboard/vapi-setup-banner'
import { WelcomeChecklist, type WelcomeChecklistItem } from '@/components/dashboard/welcome-checklist'
import { PipelineWidget } from '@/components/dashboard/pipeline-widget'
import { MetricCard } from '@/components/design-system/metric-card'
import { ActivityChart } from '@/components/design-system/activity-chart'
import { ActivityFeed, type ActivityEvent } from '@/components/design-system/activity-feed'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MetricSkeleton } from '@/components/skeletons/metric-skeleton'
import { ListSkeleton } from '@/components/skeletons/list-skeleton'

async function hasVapiIntegration(): Promise<boolean> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('integrations')
    .select('*', { count: 'exact', head: true })
    .eq('provider', 'vapi')
    .eq('is_active', true)
  return (count ?? 0) > 0
}

interface WorkspaceSetupState {
  isEmpty: boolean
  items: WelcomeChecklistItem[]
}

/**
 * Detects whether the workspace is "empty" (newly created) and returns
 * the setup checklist with current completion state.
 *
 * Empty = no agents AND no contacts AND no active integrations.
 */
async function getWorkspaceSetupState(): Promise<WorkspaceSetupState> {
  const supabase = await createClient()

  const [whatsappRes, twilioRes, agentsRes, contactsRes, reviewsRes] = await Promise.all([
    supabase.from('evolution_instances').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('integrations').select('id', { count: 'exact', head: true }).eq('provider', 'twilio').eq('is_active', true),
    supabase.from('assistant_mappings').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase.from('google_business_profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ])

  const whatsappCount = whatsappRes.count ?? 0
  const twilioCount = twilioRes.count ?? 0
  const agentsCount = agentsRes.count ?? 0
  const contactsCount = contactsRes.count ?? 0
  const reviewsCount = reviewsRes.count ?? 0

  const items: WelcomeChecklistItem[] = [
    {
      id: 'whatsapp',
      title: 'Connect WhatsApp',
      description: 'Plug in your Evolution Go instance to send and receive WhatsApp messages.',
      href: '/integrations',
      cta: 'Connect WhatsApp',
      icon: MessageSquare,
      done: whatsappCount > 0,
    },
    {
      id: 'twilio',
      title: 'Connect Twilio',
      description: 'Power outbound SMS and calls with your Twilio number.',
      href: '/integrations',
      cta: 'Connect Twilio',
      icon: PhoneCall,
      done: twilioCount > 0,
    },
    {
      id: 'agent',
      title: 'Create your first agent',
      description: 'Spin up an AI worker to handle conversations across your channels.',
      href: '/agents',
      cta: 'Create agent',
      icon: Bot,
      done: agentsCount > 0,
    },
    {
      id: 'contacts',
      title: 'Import contacts',
      description: 'Bring your customer list in via CSV or sync from your CRM.',
      href: '/contacts',
      cta: 'Import contacts',
      icon: Users,
      done: contactsCount > 0,
    },
    {
      id: 'reviews',
      title: 'Setup Google Reviews',
      description: 'Monitor and respond to Google reviews with SerpAPI integration.',
      href: '/reviews',
      cta: 'Setup reviews',
      icon: Star,
      done: reviewsCount > 0,
    },
  ]

  // "Empty" workspace: nothing meaningful yet.
  const isEmpty = agentsCount === 0 && contactsCount === 0 && whatsappCount === 0 && twilioCount === 0

  return { isEmpty, items }
}

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 6)  return 'Boa madrugada'
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function getFirstName(user: { user_metadata?: Record<string, unknown>; email?: string | null }): string {
  const full = (user.user_metadata?.full_name as string | undefined) ?? ''
  if (full) return full.trim().split(/\s+/)[0]
  if (user.email) return user.email.split('@')[0]
  return 'there'
}

function trendPct(values: number[]): number | null {
  if (values.length < 2) return null
  const half = Math.floor(values.length / 2)
  const prev = values.slice(0, half).reduce((a, b) => a + b, 0)
  const curr = values.slice(half).reduce((a, b) => a + b, 0)
  if (prev === 0 && curr === 0) return 0
  if (prev === 0) return curr > 0 ? 100 : 0
  return Math.round(((curr - prev) / prev) * 100)
}

async function HomeMetrics() {
  const supabase = await createClient()
  const [metrics, costTicker, agentCountRes] = await Promise.all([
    getDashboardMetrics(),
    getOrgCostTicker(),
    supabase.from('assistant_mappings').select('*', { count: 'exact', head: true }).eq('is_active', true),
  ])

  const todaySeries = metrics.trends.today.map((t) => ({ value: t.value }))
  const weekSeries  = metrics.trends.week.map((t) => ({ value: t.value }))

  const callsTrend = trendPct(metrics.trends.today.map((t) => t.value))
  const activeAgents = agentCountRes.count ?? 0

  const costToday = costTicker?.cost24hUsd ?? null
  const costCap = costTicker?.dailyCapUsd ?? null
  const costPct = costTicker?.pctOf24hCap ?? null
  const costHint =
    costCap !== null && costPct !== null
      ? `Daily cap $${costCap.toFixed(2)} · ${Math.round(costPct)}% used`
      : undefined

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <MetricCard
        index={0}
        label="Calls today"
        value={metrics.callsToday.toLocaleString()}
        unit="calls"
        trend={callsTrend}
        data={todaySeries}
        icon={Phone}
        tone="default"
        href="/calls"
      />
      <MetricCard
        index={1}
        label="Active agents"
        value={activeAgents.toLocaleString()}
        unit={activeAgents === 1 ? 'agent' : 'agents'}
        trend={null}
        icon={Bot}
        tone="info"
        href="/agents"
      />
      <MetricCard
        index={2}
        label="Calls this week"
        value={metrics.callsWeek.toLocaleString()}
        data={weekSeries}
        trend={trendPct(metrics.trends.week.map((t) => t.value))}
        icon={MessageSquare}
        tone="success"
        href="/calls"
      />
      <MetricCard
        index={3}
        label="Cost today"
        value={costToday !== null ? `$${costToday.toFixed(2)}` : '—'}
        trend={null}
        icon={DollarSign}
        tone={costPct !== null && costPct >= 80 ? 'warning' : 'default'}
        hint={costHint}
        href="/settings"
      />
    </div>
  )
}

async function ActivityPanel() {
  const supabase = await createClient()

  const [recentCallsRes, recentLogsRes] = await Promise.all([
    supabase
      .from('calls')
      .select('id, customer_name, customer_number, ended_reason, started_at, created_at, call_type')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('action_logs')
      .select('id, action, status, created_at, tool_name')
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  type CallEvt = {
    id: string
    customer_name: string | null
    customer_number: string | null
    ended_reason: string | null
    started_at: string | null
    created_at: string
    call_type: string | null
  }
  type LogEvt = {
    id: string
    action: string
    status: string
    created_at: string
    tool_name: string | null
  }

  const calls: CallEvt[] = (recentCallsRes.data as CallEvt[] | null) ?? []
  const logs: LogEvt[] = (recentLogsRes.data as LogEvt[] | null) ?? []

  const events: ActivityEvent[] = [
    ...calls.map((c): ActivityEvent => ({
      id: `call-${c.id}`,
      type: 'call',
      title: c.customer_name || c.customer_number || 'Anonymous caller',
      description: c.ended_reason
        ? `${c.call_type === 'inbound' ? 'Inbound' : 'Outbound'} · ended: ${c.ended_reason}`
        : `${c.call_type === 'inbound' ? 'Inbound' : 'Outbound'} call`,
      timestamp: c.created_at,
      channel: 'voice',
      href: `/calls/${c.id}`,
    })),
    ...logs.map((l): ActivityEvent => ({
      id: `log-${l.id}`,
      type: l.status === 'success' ? 'tool' : 'error',
      title: l.tool_name ?? l.action,
      description: `Action ${l.action} · ${l.status}`,
      timestamp: l.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)

  return <ActivityFeed events={events} emptyText="When activity rolls in, it'll show up right here." />
}

async function ActivityChartSection() {
  const metrics = await getDashboardMetrics()
  const data = metrics.trends.week.map((t) => ({
    label: t.date,
    calls: t.value,
  }))

  return <ActivityChart data={data} />
}

export default async function DashboardPage() {
  const [hasVapi, user, setupState] = await Promise.all([
    hasVapiIntegration(),
    getUser(),
    getWorkspaceSetupState(),
  ])
  const greeting = greetingFor(new Date())
  const firstName = user ? getFirstName(user) : 'there'

  // Empty workspace: show the welcome checklist instead of metrics/activity.
  if (setupState.isEmpty) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="animate-fade-in flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span>Welcome</span>
          </div>
          <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-text-primary">
            {greeting}, {firstName}.
          </h1>
          <p className="text-[14px] text-text-secondary">
            Your workspace is brand new. Let&apos;s get it set up so you can start operating.
          </p>
        </div>
        <WelcomeChecklist items={setupState.items} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Hero */}
      <div className="animate-fade-in flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span>Overview</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-text-primary">
              {greeting}, {firstName}.
            </h1>
            <p className="mt-1 text-[14px] text-text-secondary">
              Here is what is happening across your operations today.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/chat">
                <MessageSquare className="h-3.5 w-3.5" /> Open inbox
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/agents">
                <Plus className="h-3.5 w-3.5" /> New agent
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {!hasVapi && <VapiSetupBanner />}

      {/* Metrics */}
      <Suspense
        fallback={
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </div>
        }
      >
        <HomeMetrics />
      </Suspense>

      {/* Activity row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-fade-in delay-150">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2">
              <span>Activity</span>
              <Badge variant="default">7 days</Badge>
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/calls">
                Full report <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <Suspense fallback={<div className="h-[220px] w-full shimmer rounded-[8px]" />}>
              <ActivityChartSection />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Suspense fallback={<ListSkeleton rows={6} />}>
              <ActivityPanel />
            </Suspense>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline widget */}
      <div className="animate-fade-in delay-200">
        <Suspense fallback={<div className="h-[240px] w-full shimmer rounded-[12px]" />}>
          <PipelineWidget />
        </Suspense>
      </div>

      {/* Quick actions */}
      <div className="animate-fade-in delay-225">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            Quick actions
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <QuickAction
            icon={MessageSquare}
            label="New conversation"
            description="Open the inbox"
            href="/chat"
          />
          <QuickAction
            icon={Bot}
            label="Create agent"
            description="Build a new AI worker"
            href="/agents"
          />
          <QuickAction
            icon={Users}
            label="Invite member"
            description="Bring your team in"
            href="/members"
          />
          <QuickAction
            icon={Zap}
            label="Connect integration"
            description="WhatsApp, Vapi, more"
            href="/integrations"
          />
        </div>
      </div>
    </div>
  )
}

function QuickAction({
  icon: Icon,
  label,
  description,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="group relative flex items-center gap-3 rounded-[12px] border border-border bg-bg-secondary p-4 shadow-elevation-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elevation-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-bg-tertiary ring-1 ring-border-subtle text-text-secondary group-hover:text-accent group-hover:bg-accent-muted transition-colors duration-200">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-text-primary truncate">{label}</span>
        <span className="text-[12px] text-text-tertiary truncate">{description}</span>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0" />
    </Link>
  )
}

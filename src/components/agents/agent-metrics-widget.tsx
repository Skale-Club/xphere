// src/components/agents/agent-metrics-widget.tsx
// Phase 40 OBS-04: Per-agent metrics widget for /dashboard/agents/[id].
// Server component | fetches data via observability server actions.

import { Suspense } from 'react'
import {
  getAgentMetrics,
  type ObsWindow,
} from '@/lib/agent-runtime/observability'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface AgentMetricsWidgetProps {
  agentId: string
}

async function MetricsContent({
  agentId,
  window,
}: {
  agentId: string
  window: ObsWindow
}) {
  const m = await getAgentMetrics(agentId, window)
  if (!m || m.invocationCount === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No invocations in this window.
      </p>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <MetricCard label="Invocations" value={m.invocationCount.toLocaleString()} />
      <MetricCard label="p50 Latency" value={formatMs(m.p50LatencyMs)} />
      <MetricCard label="p95 Latency" value={formatMs(m.p95LatencyMs)} />
      <MetricCard label="Total Cost" value={formatCost(m.totalCostUsd)} />
      {m.toolCallSuccessRate !== null && (
        <div className="col-span-2 sm:col-span-4 pt-1 border-t">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Tool Call Success Rate
          </p>
          <p className="text-lg font-semibold">
            {m.toolCallSuccessRate}%
          </p>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="text-2xl font-bold tracking-tight">{value}</span>
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms === 0) return '|'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.0001) return '<$0.0001'
  return `$${usd.toFixed(4)}`
}

function LoadingState() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 bg-muted rounded" />
      ))}
    </div>
  )
}

export function AgentMetricsWidget({ agentId }: AgentMetricsWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Agent Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="24h">
          <TabsList className="mb-4">
            <TabsTrigger value="24h">24h</TabsTrigger>
            <TabsTrigger value="7d">7d</TabsTrigger>
            <TabsTrigger value="30d">30d</TabsTrigger>
          </TabsList>
          <TabsContent value="24h">
            <Suspense fallback={<LoadingState />}>
              <MetricsContent agentId={agentId} window="24h" />
            </Suspense>
          </TabsContent>
          <TabsContent value="7d">
            <Suspense fallback={<LoadingState />}>
              <MetricsContent agentId={agentId} window="7d" />
            </Suspense>
          </TabsContent>
          <TabsContent value="30d">
            <Suspense fallback={<LoadingState />}>
              <MetricsContent agentId={agentId} window="30d" />
            </Suspense>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

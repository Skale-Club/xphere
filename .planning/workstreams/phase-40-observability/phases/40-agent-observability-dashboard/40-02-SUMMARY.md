---
phase: 40-agent-observability-dashboard
plan: 40-02
subsystem: ui
tags: [react, tailwind, shadcn, recharts]

requires:
  - phase: 40-01
    provides: getAgentMetrics, getOrgCostTicker server actions + types

provides:
  - src/components/agents/agent-metrics-widget.tsx — 3-tab metrics card (OBS-04)
  - src/components/dashboard/cost-ticker.tsx — cost ticker with progress bar (OBS-05)
  - Wired into agents/[id]/page.tsx and dashboard page.tsx

tech-stack:
  added: []
  patterns: [async server components, Suspense fallback, Tabs from shadcn]

key-files:
  created: [src/components/agents/agent-metrics-widget.tsx, src/components/dashboard/cost-ticker.tsx]
  modified: [src/app/(dashboard)/agents/[id]/page.tsx, src/app/(dashboard)/page.tsx]

key-decisions:
  - "AgentMetricsWidget is a server component — all 3 tab MetricsContent blocks SSR in parallel via Suspense"
  - "CostTicker returns null when no org found — widget disappears gracefully"
  - "Alert badge uses orange-500/10 at ≥80% cap consumption"

## Self-Check: PASSED

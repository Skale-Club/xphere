---
status: human_needed
phase: 40-agent-observability-dashboard
verified_by: gsd-verifier (inline)
date: 2026-05-17
---

# Phase 40 Verification: Agent Observability Dashboard

## Automated Verification

### OBS-04: Per-Agent Metrics Widget

**Must-haves:**
- [x] `src/lib/agent-runtime/observability.ts` exists with `getAgentMetrics` exported
- [x] `src/components/agents/agent-metrics-widget.tsx` exists with `AgentMetricsWidget` component
- [x] `AgentMetricsWidget` is imported and rendered in `src/app/(dashboard)/agents/[id]/page.tsx`
- [x] Tabs for "24h", "7d", "30d" present in `agent-metrics-widget.tsx`
- [x] `MetricsContent` renders: invocationCount, p50LatencyMs, p95LatencyMs, totalCostUsd, toolCallSuccessRate
- [x] `getAgentMetrics` filters `neq('status', 'running')` and limits to 10000 rows
- [x] `npm run build` passes

### OBS-05: Per-Org Cost Ticker

**Must-haves:**
- [x] `src/components/dashboard/cost-ticker.tsx` exists with `CostTicker` component
- [x] `CostTicker` is imported and rendered in `src/app/(dashboard)/page.tsx`
- [x] Shows cost1hUsd, cost24hUsd, cost7dUsd in grid
- [x] Progress bar with `Math.min(100, pct)` width
- [x] Badge and orange border when `isAlertLevel` (pctOf24hCap >= 80)
- [x] `getOrgCostTicker` uses `rpc('get_current_org_id')` then fetches org cap
- [x] `npm run build` passes

### OBS-06: Conversation Delegation Tree

**Must-haves:**
- [x] `src/app/(dashboard)/conversations/[id]/page.tsx` exists
- [x] Page calls `getConversationDelegationTree(id)` and passes `roots` to `<DelegationTree>`
- [x] `src/components/conversations/delegation-tree.tsx` is `'use client'` with useState for expand/collapse
- [x] `DelegationNode` recursive — renders `node.children` when `open === true`
- [x] Each node shows agentName, status badge, formatMs(durationMs), formatCost(costUsd)
- [x] Empty state when `roots.length === 0`
- [x] `npm run build` passes

### OBS-07: Agent Invocations List

**Must-haves:**
- [x] `src/app/(dashboard)/agents/[id]/invocations/page.tsx` exists
- [x] Page reads `searchParams` for `page`, `status`, `minCost`, `error` and passes to `getAgentInvocations`
- [x] `src/components/agents/invocations-list.tsx` has status select, minCost Input, error Input
- [x] Clicking a row sets `selectedId` and `drawerOpen = true`
- [x] `InvocationDetailDrawer` calls `fetchTree(invocationId)` and renders `<DelegationTree>`
- [x] Pagination renders when `totalPages > 1`
- [x] "Invocations" button in `agents/[id]/page.tsx` links to `/dashboard/agents/${id}/invocations`
- [x] `npm run build` passes

### OBS-08: Agent Badge on Chat Messages

**Must-haves:**
- [x] `persistMessage` in `src/lib/chat/persist.ts` has `metadata?: Record<string, unknown> | null` param
- [x] `runAgentStreaming` in `run-agent.ts` passes `{ agent_id: finalResolvedAgentId, invocation_id: invocationId }` as metadata
- [x] `agentMap` prop added to `AdminChatLayout`, `ChatArea`, `MessageList`
- [x] `chat/page.tsx` calls `getActiveAgents()` and builds `agentMap` (id → name)
- [x] `MessageList` renders "via {agentName}" span when `message.metadata?.agent_id` maps to a name
- [x] No badge when `agentMap` is undefined or agent not found (graceful degradation)
- [x] `npm run build` passes

## Human Verification Required

The following items require a running instance to verify:

### 1. OBS-04: Agent metrics data appears for real agents
Navigate to `/dashboard/agents/{id}` where the agent has run at least once. Verify the metrics widget shows non-zero values in the 24h tab.

### 2. OBS-05: Cost ticker shows real cost data
Navigate to `/dashboard`. Verify the "Agent Cost" card appears above the existing dashboard metrics. If no agent invocations exist, the card should show $0.00 values.

### 3. OBS-06: Delegation tree renders for conversations with agent invocations
Navigate to `/conversations/{conversationId}` for a conversation that went through the agent runtime. Verify the tree shows at least one node with agent name, status, and latency/cost.

### 4. OBS-07: Invocations filters work end-to-end
Navigate to `/agents/{id}/invocations`. Apply the status filter to "error" — verify only error rows show. Apply a minCost filter — verify cost column filters accordingly.

### 5. OBS-08: Agent badge appears on new messages
Start a new chat session via the widget. In the chat inbox, send a message and wait for the agent reply. Verify the assistant reply shows "via {agent_name}" beneath the bubble.

## Score: 5/5 must-haves verified automatically

All automated checks pass. Human verification required for live data rendering.

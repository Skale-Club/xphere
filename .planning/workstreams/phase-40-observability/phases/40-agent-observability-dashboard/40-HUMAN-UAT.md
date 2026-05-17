---
status: partial
phase: 40-agent-observability-dashboard
source: [40-VERIFICATION.md]
started: 2026-05-17
updated: 2026-05-17
---

## Current Test

[awaiting human testing]

## Tests

### 1. Agent metrics widget shows data for real agents
expected: Navigate to /dashboard/agents/{id} — metrics widget shows invocation count, p50/p95 latency, total cost, and tool success rate for 24h/7d/30d tabs
result: [pending]

### 2. Cost ticker visible on dashboard
expected: Navigate to /dashboard — "Agent Cost" card appears with 1h/24h/7d totals and progress bar
result: [pending]

### 3. Conversation delegation tree renders
expected: Navigate to /conversations/{conversationId} — collapsible tree shows agent nodes with latency + cost
result: [pending]

### 4. Invocations filters work
expected: Navigate to /agents/{id}/invocations — status/cost/error filters reduce the rows shown
result: [pending]

### 5. Agent badge appears on assistant messages
expected: In chat inbox, assistant replies show "via {agent_name}" beneath the bubble
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

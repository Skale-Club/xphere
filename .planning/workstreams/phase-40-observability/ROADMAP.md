# Roadmap: Phase 40 — Agent Observability Dashboard

**Workstream:** phase-40-observability
**Milestone:** v2.0 Multi-Bot Platform
**Created:** 2026-05-17

## Phases

### Phase 40: Agent Observability Dashboard
**Goal**: Admins can answer "how is each agent performing, what does it cost, and what happened in this conversation" via dashboard widgets backed by the `agent_invocations` rows that have been written since Phase 34. Includes per-agent metrics, per-org cost ticker, conversation drill-in with delegation tree, invocations list with filters, and per-message agent badges in the existing chat-area.
**Depends on**: Phase 34 ✅, Phase 36 ✅, Phase 38 ✅
**Requirements**: OBS-04, OBS-05, OBS-06, OBS-07, OBS-08
**Success Criteria** (what must be TRUE):
  1. `/dashboard/agents/[id]` shows a metrics widget with invocation count, p50/p95 latency, total cost, and tool-call success rate over 24h / 7d / 30d windows
  2. `/dashboard` shows a per-org cost ticker with 1h / 24h / 7d totals and `% of daily cap consumed`; an alert badge appears when consumption ≥80% of cap
  3. `/dashboard/conversations/[id]` renders a delegation tree (collapsible nested invocations) with cost + latency annotated per node
  4. `/dashboard/agents/[id]/invocations` lists recent invocations filterable by status, cost, and error; clicking an invocation opens its delegation tree view
  5. Existing chat-area component shows an agent badge on each assistant message identifying which agent produced it
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 40. Agent Observability Dashboard | 0/? | Complete    | 2026-05-17 |

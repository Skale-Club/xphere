---
phase: 40-agent-observability-dashboard
plan: 40-04
subsystem: ui
tags: [react, table, dialog, server-actions]

requires:
  - phase: 40-01
    provides: getAgentInvocations, getInvocationDelegationTree, InvocationListItem

provides:
  - src/components/agents/invocation-detail-drawer.tsx — Dialog with delegation tree
  - src/components/agents/invocations-list.tsx — filterable table (OBS-07)
  - src/app/(dashboard)/agents/[id]/invocations/page.tsx — invocations page (OBS-07)

key-files:
  created: [src/components/agents/invocation-detail-drawer.tsx, src/components/agents/invocations-list.tsx, src/app/(dashboard)/agents/[id]/invocations/page.tsx]

key-decisions:
  - "getInvocationDelegationTree passed as fetchTree prop — server action bridge pattern"
  - "Filters use URL search params (router.push) for SSR + bookmarkable state"
  - "useEffect in InvocationDetailDrawer re-fetches when invocationId or open changes"

## Self-Check: PASSED

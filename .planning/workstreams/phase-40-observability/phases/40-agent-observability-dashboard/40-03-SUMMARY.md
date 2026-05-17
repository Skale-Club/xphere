---
phase: 40-agent-observability-dashboard
plan: 40-03
subsystem: ui
tags: [react, tailwind, radix, tree-view]

requires:
  - phase: 40-01
    provides: getConversationDelegationTree, InvocationTreeNode

provides:
  - src/components/conversations/delegation-tree.tsx — collapsible tree (OBS-06)
  - src/app/(dashboard)/conversations/[id]/page.tsx — conversation detail page (OBS-06)

key-files:
  created: [src/components/conversations/delegation-tree.tsx, src/app/(dashboard)/conversations/[id]/page.tsx]

key-decisions:
  - "DelegationNode uses React useState for open/close — no external Collapsible dependency"
  - "border-l-2 border-muted creates visual tree hierarchy indentation"
  - "status colors use a switch statement matching all 6 AgentInvocationStatus values"

## Self-Check: PASSED

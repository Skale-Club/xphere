---
phase: 40-agent-observability-dashboard
plan: 40-05
subsystem: ui
tags: [react, chat, metadata]

requires:
  - phase: 40-01
    provides: persistMessage writes metadata.agent_id on assistant messages

provides:
  - Agent badge ("via {agentName}") below assistant message bubbles in chat inbox (OBS-08)
  - agentMap threaded: chat/page.tsx → AdminChatLayout → ChatArea → MessageList

key-files:
  modified: [src/app/(dashboard)/chat/page.tsx, src/components/chat/admin-chat-layout.tsx, src/components/chat/chat-area.tsx, src/components/chat/chat-area/message-list.tsx]

key-decisions:
  - "agentMap optional prop throughout chain — graceful degradation if missing"
  - "message.metadata?.agent_id is cast as string | undefined — safe optional chain"
  - "Badge renders 'via {agentName}' only when agentId maps to a known agent"

## Self-Check: PASSED

# Roadmap: Phase 39 — Agent Playground

## Overview

This workstream delivers a test playground for each agent at `/dashboard/agents/[id]/playground`.
Admins can chat against the agent across channel modes; tool calls and partner invocations render
inline. Playground sessions carry `mode='playground'` so they're excluded from production
observability counts and don't write to `conversations`/`conversation_messages`.

## Phases

- [x] **Phase 39: Agent Playground** - Per-agent test playground page with multi-channel chat, (completed 2026-05-17)
  inline tool-call rendering, session reset, and playground-mode isolation from production metrics.

## Phase Details

### Phase 39: Agent Playground
**Goal**: Each agent has a test playground at `/dashboard/agents/[id]/playground` where an admin
chats against the agent across channel modes; tool calls and partner invocations render inline;
playground sessions carry `mode='playground'` so they're excluded from production observability
counts and don't write to `conversations`/`conversation_messages`.
**Depends on**: Phase 36, Phase 38
**Requirements**: PLAY-01, PLAY-02, PLAY-03, PLAY-04, PLAY-05
**Success Criteria** (what must be TRUE):
  1. Admin opens `/dashboard/agents/[id]/playground`, sends a message, and sees the streamed reply inline reusing the v1.4 chat-area `MessageList` component; tool calls display arguments + result + timing inline
  2. Channel selector (web_widget, whatsapp, messenger, instagram, manychat, telegram) re-applies the corresponding `channel_overrides` on every send; switching channel mid-session is allowed
  3. "New session" button resets conversation context but preserves the current agent + channel selection
  4. Playground invocations carry `mode='playground'` in the runtime context; resulting `agent_invocations` rows are tagged `mode='playground'` and are excluded from production cost/latency widgets and the per-org cost ticker
  5. No row is written to `conversations` or `conversation_messages` from a playground run (verified by snapshot diff before/after)
**Plans**: TBD

---

*Workstream created: 2026-05-17*

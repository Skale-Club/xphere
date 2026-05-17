# Requirements: Phase 39 — Agent Playground

**Milestone:** v2.0 Multi-Bot Platform
**Phase:** 39 — Agent Playground
**Source:** Phase 39 definition in task description

## Phase 39 Requirements

### PLAY — Agent Playground

- [ ] **PLAY-01:** Admin opens `/dashboard/agents/[id]/playground`, sends a message, and sees the streamed reply inline reusing the v1.4 chat-area `MessageList` component; tool calls display arguments + result + timing inline
- [ ] **PLAY-02:** Channel selector (web_widget, whatsapp, messenger, instagram, manychat, telegram) re-applies the corresponding `channel_overrides` on every send; switching channel mid-session is allowed
- [ ] **PLAY-03:** "New session" button resets conversation context but preserves the current agent + channel selection
- [ ] **PLAY-04:** Playground invocations carry `mode='playground'` in the runtime context; resulting `agent_invocations` rows are tagged `mode='playground'` and are excluded from production cost/latency widgets and the per-org cost ticker
- [ ] **PLAY-05:** No row is written to `conversations` or `conversation_messages` from a playground run (verified by snapshot diff before/after)

---

*Requirements defined: 2026-05-17*

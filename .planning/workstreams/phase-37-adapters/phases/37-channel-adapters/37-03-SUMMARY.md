---
plan: 37-03
phase: 37
status: complete
completed: 2026-05-16
---

# Summary: Plan 37-03 — Meta process-event Agent Branch

## What was built

Extended `src/lib/meta/process-event.ts` with XOR branching on `metaChannel.agent_id`:

- **Agent path (v2.0)**: When `metaChannel.agent_id` is non-null, `dispatchAgentReply()` calls `runAgent({ channel: channelType, stream: false })`, formats the reply via `formatMeta()` (2000-char text chunks, markdown stripped), decrypts the page access token, sends each chunk via `sendMetaMessage()`, and persists the reply to `conversation_messages`
- **Legacy path (v1.x)**: When `metaChannel.agent_id` is null, the original `automationId` / keyword-trigger / `tool_config_id` → `executeAction` flow runs unchanged below the `if (agentId)` branch

The `meta_channels` select was extended to include `agent_id` and `encrypted_page_access_token`.

## Key decisions

- `dispatchAgentReply()` is separate from the main loop — cleaner error containment
- Agent path errors are caught and logged as non-fatal (webhook already returned 200 via `after()`)
- Conversation creation/update logic preserved from v1.x — agent path reuses the same `conversationId`

## Commits

- `feat(37-02/37-03): add agent dispatch branches to ManyChat and Meta event handlers (CHAN-04/CHAN-05)`

## Self-Check: PASSED

- XOR branch on `agentId` present (`if (agentId)`)
- `meta_channels` select includes `agent_id` and `encrypted_page_access_token`
- `runAgent({ channel: channelType, stream: false })` called
- Legacy automation path preserved unchanged
- Agent reply persisted to `conversation_messages` as `role: 'assistant'`

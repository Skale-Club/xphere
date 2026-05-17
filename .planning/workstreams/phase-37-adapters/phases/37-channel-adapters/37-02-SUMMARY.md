---
plan: 37-02
phase: 37
status: complete
completed: 2026-05-16
---

# Summary: Plan 37-02 — ManyChat Dispatcher Agent Branch

## What was built

Extended `src/lib/manychat/dispatch-event.ts` with XOR branching on `rule.agent_id`:

- **Agent path (v2.0)**: When `rule.agent_id` is non-null, `dispatchAgentPath()` calls `runAgent({ channel: 'manychat', stream: false })`, formats the reply via `formatManychat()` (640-char Dynamic Block v2 chunks), and sends each chunk via `sendManychatMessage()`
- **Legacy path (v1.x)**: When `rule.agent_id` is null, `dispatchLegacyPath()` runs the original `resolveToolById` → `executeAction` → `action_logs` flow byte-identically

Added `subscriberId` field to `DispatchInput` interface for agent reply delivery.

## Key decisions

- Added `subscriberId` to `DispatchInput` because the agent path requires a subscriber ID to send the reply, while the legacy path didn't need it explicitly (it was in the payload)
- Credentials are fetched from `manychat_channels` using `channelId` — matches the existing channel resolution pattern
- All errors caught in agent path → event row updated to `status: 'error'`

## Commits

- `feat(37-02/37-03): add agent dispatch branches to ManyChat and Meta event handlers (CHAN-04/CHAN-05)`

## Self-Check: PASSED

- XOR branch on `rule.agent_id` present
- `runAgent({ channel: 'manychat', stream: false })` called in agent path
- Legacy path preserves `action_logs` insert with `vapi_call_id: manychat:{eventId}`
- Function never throws

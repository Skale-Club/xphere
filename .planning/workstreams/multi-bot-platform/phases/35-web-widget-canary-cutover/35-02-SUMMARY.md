---
phase: 35-web-widget-canary-cutover
plan: "02"
subsystem: agent-runtime
tags: [agent-runtime, types, kb-injection, agent-resolution, channel-defaults]
dependency_graph:
  requires: [33-schema-foundation, 34-agent-runtime-skeleton]
  provides: [optional-agentId, agent-channel-resolution, unconditional-kb]
  affects: [run-agent, types, phase-35-03-streaming]
tech_stack:
  added: []
  patterns: [agent_channel_defaults-resolution, unconditional-kb-injection]
key_files:
  created: []
  modified:
    - src/lib/agent-runtime/types.ts
    - src/lib/agent-runtime/run-agent.ts
decisions:
  - "agentId made optional in AgentRunOptions; resolved from agent_channel_defaults when absent (D-35-06)"
  - "KB injection unconditional — null kbScope = full org KB, matching legacy stream.ts (GATE-01)"
  - "stream?: boolean added to AgentRunOptions for Phase 35-03 streaming overload (D-35-01)"
metrics:
  duration: "11 min"
  completed_date: "2026-05-16"
  tasks_completed: 2
  files_modified: 2
---

# Phase 35 Plan 02: AgentRunOptions Extension + Agent Resolution + Unconditional KB Summary

**One-liner:** Made agentId optional with agent_channel_defaults fallback resolution and unconditional KB injection matching legacy stream.ts behavior for GATE-01.

## What Was Built

Extended `AgentRunOptions` in `types.ts` and fixed two blocking issues in `run-agent.ts`:

1. **agentId is now optional** — `AgentRunOptions.agentId?: string`. When not provided, `runAgent` queries `agent_channel_defaults WHERE organization_id = $orgId AND channel = $channel` to resolve the agent before any other step. Returns graceful error (`status: 'error', errorDetail: 'no_agent_for_channel'`) if no default row exists.

2. **KB injection is unconditional** — Removed the `if (resolvedAgent.kbScope !== null && resolvedAgent.kbScope.length > 0)` gate. `queryKnowledge` is now always called. When `kbContext` equals the fallback string, it is not appended. The prefix `Relevant knowledge base content:` matches `stream.ts` exactly (GATE-01 byte-identical behavior).

3. **stream?: boolean added** — `AgentRunOptions` gains `stream?: boolean` for the Phase 35-03 streaming overload. The non-streaming path is unchanged.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend AgentRunOptions in types.ts | d6f8c59 | src/lib/agent-runtime/types.ts |
| 2 | Fix agent resolution and KB injection in run-agent.ts | d6f8c59 | src/lib/agent-runtime/run-agent.ts |

Note: Tasks 1 and 2 were committed together since TypeScript type correctness required both changes simultaneously (making agentId optional in types.ts caused immediate build errors in run-agent.ts, which were resolved by Task 2's changes).

## Verification

- `grep "agentId?: string" src/lib/agent-runtime/types.ts` — matches
- `grep "stream?: boolean" src/lib/agent-runtime/types.ts` — matches
- `grep -c "agent_channel_defaults" src/lib/agent-runtime/run-agent.ts` — returns 2
- `grep "kbScope !== null" src/lib/agent-runtime/run-agent.ts` — no match (gate removed)
- `grep "Relevant knowledge base content" src/lib/agent-runtime/run-agent.ts` — matches
- `npm run build` — exit 0

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as specified.

### Note: Merge of main branch

Before executing, merged `main` into the worktree to bring in Phase 34 agent-runtime code (the worktree was branched from `9ccd124` which predated Phase 34). The merge was clean with no conflicts. Commit `383aaf1`.

## Known Stubs

None — this plan only modifies type definitions and control flow. No UI components, no placeholder data.

## Self-Check: PASSED

Files verified:
- src/lib/agent-runtime/types.ts — exists, contains `agentId?: string` and `stream?: boolean`
- src/lib/agent-runtime/run-agent.ts — exists, contains `agent_channel_defaults`, `Relevant knowledge base content:`, no `kbScope !== null` gate

Commits verified:
- `383aaf1` — merge main (Phase 34 + 35 foundation)
- `d6f8c59` — feat(35-02) types + run-agent changes

# Phase 35: Web Widget Canary Cutover — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md.

**Date:** 2026-05-16
**Phase:** 35-web-widget-canary-cutover
**Areas discussed:** All decisions made by orchestrator (infrastructure phase)

---

## Note on Discussion Mode

This is a pure infrastructure refactor phase with no user-facing choices. The user indicated they were not familiar with the technical tradeoffs ("nao tenho ideia do que é isso" — I have no idea what this is). All decisions were made by the orchestrator based on the existing codebase patterns, REQUIREMENTS.md constraints, and Phase 34 implementation facts.

## Decisions Made (All by Orchestrator)

| Decision | Choice | Rationale |
|---|---|---|
| Streaming output shape | ReadableStream<Uint8Array> (SSE-ready) | Route.ts can return directly; createChatStream shim is one-liner |
| sessionId in stream | Passed via AgentRunOptions | Required for session SSE event (GATE-01) |
| Persist responsibility | runAgent owns assistant message; route.ts owns user message + Redis | Cleaner separation; no onReplyChunk callback |
| createChatStream shim | Preserved with same signature | Rollback path + CHAN-03 requirement |
| conversations.agent_id | Migration 043 + backfill in Phase 35 | GATE-07 literal query deferred from Phase 33 |
| Agent resolution | Inside runAgent (not in route.ts) | Route.ts passes orgId + channel only |
| maxDuration = 10 | Added to route.ts | CHAN-03 explicit requirement |
| GATE-01 snapshot | Shape conformance test (not content diff) | LLM output is non-deterministic |
| Streaming LLM call | streamText from ai@^6 | Natural extension of Phase 34 adoption |
| UI changes | None | Phase 35 is infrastructure only |

## Deferred Ideas

None raised during discussion.

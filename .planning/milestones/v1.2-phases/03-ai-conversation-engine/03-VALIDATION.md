---
phase: 3
slug: ai-conversation-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-04
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npx vitest run tests/chat-api.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/chat-api.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | CHAT-01 | unit | `npx vitest run tests/chat-api.test.ts` | ✅ (needs update) | ⬜ pending |
| 03-01-02 | 01 | 0 | CHAT-02 | unit | `npx vitest run tests/chat-api.test.ts` | ✅ (needs update) | ⬜ pending |
| 03-01-03 | 01 | 0 | CHAT-03 | unit | `npx vitest run tests/chat-api.test.ts` | ✅ (needs update) | ⬜ pending |
| 03-02-01 | 02 | 1 | CHAT-01 | unit | `npx vitest run tests/chat-api.test.ts` | ✅ | ⬜ pending |
| 03-02-02 | 02 | 1 | CHAT-02 | unit | `npx vitest run tests/chat-api.test.ts` | ✅ | ⬜ pending |
| 03-02-03 | 02 | 1 | CHAT-03 | unit | `npx vitest run tests/chat-api.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/chat-api.test.ts` — update "returns 200 with sessionId" test to read stream lines (not `res.json()`) and assert SSE event sequence
- [ ] `tests/chat-api.test.ts` — add CHAT-01 streaming test: assert `Content-Type: text/event-stream`, session event, token events, done event
- [ ] `tests/chat-api.test.ts` — add CHAT-02 test: mock `queryKnowledge`, assert called before LLM mock
- [ ] `tests/chat-api.test.ts` — add CHAT-03 test: mock LLM to return tool_use, assert `executeAction` called and `tool_call` SSE event emitted
- [ ] `tests/chat-api.test.ts` — add D-12 degradation test: no API keys → stream contains degradation message then done event
- [ ] `tests/helpers/stream.ts` — SSE stream reader helper for reading lines from a `ReadableStream` response

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stream tokens visually appear progressively in browser | CHAT-01 | Browser rendering behavior | Open widget, send message, observe tokens arriving incrementally |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

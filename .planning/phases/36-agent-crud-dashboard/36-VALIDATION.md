---
phase: 36
slug: agent-crud-dashboard
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-16
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `36-RESEARCH.md` → Validation Architecture section.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 with `@vitejs/plugin-react` |
| **Config file** | `vitest.config.ts` (environment: node, globals: true, include: `tests/**/*.test.ts(x)`, setup: `tests/setup/load-env.ts`, testTimeout: 30000) |
| **Quick run command** | `npx vitest run tests/agents` (Phase 36 scope only) |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~10-15 seconds (Phase 36 scope); ~60-90 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run tests/agents` (Phase 36 scope only — fast)
- **After every plan wave:** `npm test` (full suite — catches cross-Phase regressions, especially `agent_channel_defaults`-dependent tests in Phase 35)
- **Before `/gsd:verify-work`:** `npm test` GREEN + `npm run build` clean
- **Max feedback latency:** ~15s (per-task), ~90s (per-wave)

---

## Per-Task Verification Map (Phase Requirements → Test Map)

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| AGENT-01 | createAgent inserts with required fields; rejects duplicate slug per org | integration | `npx vitest run tests/agents/actions.test.ts -t "createAgent"` | ❌ Wave 0 |
| AGENT-01 | zod schema validates required fields (name, slug, system_prompt, model) | unit | `npx vitest run tests/agents/zod-schemas.test.ts -t "agentSchema"` | ❌ Wave 0 |
| AGENT-02 | max_history persists; temperature/max_tokens persist (assumes Q1 resolution — column-add migration) | integration | `npx vitest run tests/agents/actions.test.ts -t "generation"` | ❌ Wave 0 |
| AGENT-03 | fallback_message defaults applied; updates persist | integration | `npx vitest run tests/agents/actions.test.ts -t "fallback"` | ❌ Wave 0 |
| AGENT-08 | setChannelDefault upserts; passing null deletes the row | integration | `npx vitest run tests/agents/actions.test.ts -t "setChannelDefault"` | ❌ Wave 0 |
| TOOL-02 | setAgentTools diff-inserts new and diff-deletes removed | integration | `npx vitest run tests/agents/actions.test.ts -t "setAgentTools"` | ❌ Wave 0 |
| TOOL-03 | Creating a new agent results in zero rows in agent_tools | integration | `npx vitest run tests/agents/actions.test.ts -t "deny-by-default"` | ❌ Wave 0 |
| TOOL-04 | Tool picker data includes integration_id join and `is_active` flag from integrations | unit (data shape) | `npx vitest run tests/agents/tool-picker-data.test.ts` | ❌ Wave 0 |
| D-36-06 | slugify('  Hello World!! ') === 'hello-world'; long names truncate at 50 | unit | `npx vitest run tests/agents/slug.test.ts` | ❌ Wave 0 |
| D-36-03 | channelOverrideSchema strips empty fields (temperature undefined → key removed) | unit | `npx vitest run tests/agents/zod-schemas.test.ts -t "channel_overrides"` | ❌ Wave 0 |
| D-36-07 | softDeleteAgent reassigns channel_defaults to Main Agent; refuses if Main Agent missing or target is Main Agent | integration | `npx vitest run tests/agents/actions.test.ts -t "softDelete"` | ❌ Wave 0 |
| RLS | Cross-org isolation: org A cannot SELECT/UPDATE agents from org B | integration | `npx vitest run tests/agents/rls.test.ts` | ❌ Wave 0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 (file scaffolds + fixtures) is established by Plan 02 (zod schemas + helpers) and Plan 03 (test fixtures + list-actions tests). The following Phase 36 test artifacts must exist before downstream waves can verify:

- [ ] `tests/agents/fixtures.ts` — shared fixture for seeded org + Main Agent + at least 2 tool_configs in 2 folders (Plan 03)
- [ ] `tests/agents/slug.test.ts` — unit tests for slugify helper (Plan 02)
- [ ] `tests/agents/zod-schemas.test.ts` — unit tests for `agentSchema`, `channelOverrideSchema`, slug regex (Plan 02)
- [ ] `tests/agents/list-actions.test.ts` — integration tests for getAgents/getChannelDefaults/setChannelDefault/toggleAgentActive/softDeleteAgent (Plan 03)
- [ ] `tests/agents/form-actions.test.ts` — integration tests for createAgent/updateAgent/setAgentTools (Plan 04 Task 1)
- [ ] `tests/agents/tool-picker-data.test.ts` — unit tests for the picker's grouping helpers (may be folded into form-actions or component-level test — Plan 04)
- [ ] `tests/agents/rls.test.ts` — cross-org isolation tests (Plan 05 Task 1)
- [ ] `tests/agents/phase-gate.test.ts` — end-to-end phase-gate lifecycle (Plan 05 Task 2)

No framework install needed — Vitest 4.1.2 already installed (verified in `package.json`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auto-slug field stops auto-filling once user manually edits slug | D-36-06 | RHF `watch` + `useRef('slugTouched')` behavior is timing-sensitive; reliable RTL test would add disproportionate complexity for a Phase-36-only UX detail. | 1. Open `/agents/new`. 2. Type "Hello World" into Name → Slug auto-fills to "hello-world". 3. Edit Slug to "custom-slug". 4. Type more text into Name → Slug stays "custom-slug" (does NOT re-fill). |
| Tool picker warning icon hover shows tooltip text | TOOL-04 | Tooltip hover behavior depends on Radix portals + pointer events; covered conceptually by component tests in Plan 04 acceptance (grep for AlertTriangle + TooltipContent), but visual confirmation is faster manually. | 1. Mark an integration as `is_active=false` in DB. 2. Open `/agents/[id]` → Tools section. 3. Hover the amber triangle next to the affected tool → tooltip says "Integration missing or inactive. Tool will fail at runtime." |
| Collapsible form sections open/close smoothly without layout shift | D-36-02 | Animation feel is subjective and outside automated coverage. | 1. Open `/agents/[id]`. 2. Click each of the 4 section headers (Basics / Generation / Tools / Channels). 3. Verify smooth collapse + no scroll-position jumps. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every plan task has a `<verify><automated>` block)
- [x] Wave 0 covers all MISSING references (Plans 02, 03, 04, 05 collectively create the full test set)
- [x] No watch-mode flags (all commands use `vitest run`, not `vitest`)
- [x] Feedback latency < 15s (Phase 36 scope) / < 90s (full suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-16

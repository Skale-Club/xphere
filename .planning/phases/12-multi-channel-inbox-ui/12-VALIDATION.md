---
phase: 12
slug: multi-channel-inbox-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-05
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/meta-inbox*` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/meta-inbox*`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 0 | METAINBOX-01,02 | unit | `npx vitest run tests/meta-inbox-channel-icons.test.ts tests/meta-inbox-filter.test.ts` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 0 | METAINBOX-04,05,06 | unit | `npx vitest run tests/meta-inbox-header.test.ts tests/meta-inbox-24h-banner.test.ts tests/meta-inbox-bot-toggle.test.ts` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | METAINBOX-01,02 | integration | `npx vitest run tests/meta-inbox-channel-icons.test.ts tests/meta-inbox-filter.test.ts` | ✅ W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | METAINBOX-04,05,06 | integration | `npx vitest run tests/meta-inbox-header.test.ts tests/meta-inbox-24h-banner.test.ts tests/meta-inbox-bot-toggle.test.ts` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/migrations/023_conversations_bot_status.sql` — adds bot_status column
- [ ] `src/types/database.ts` — updated with bot_status field
- [ ] `tests/meta-inbox-channel-icons.test.ts` — RED stubs for METAINBOX-01
- [ ] `tests/meta-inbox-filter.test.ts` — RED stubs for METAINBOX-02
- [ ] `tests/meta-inbox-header.test.ts` — RED stubs for METAINBOX-04
- [ ] `tests/meta-inbox-24h-banner.test.ts` — RED stubs for METAINBOX-05
- [ ] `tests/meta-inbox-bot-toggle.test.ts` — RED stubs for METAINBOX-06

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Channel icons visible in inbox | METAINBOX-01 | Requires visual browser verification | Open /chat, confirm Globe/Instagram/Messenger icons appear per conversation row |
| Filter pills work live | METAINBOX-02 | Requires live conversations of each channel type | Click "Instagram only" filter — confirm only Instagram conversations remain |
| Header shows account name | METAINBOX-04 | Requires connected Meta channel data | Open Meta conversation, confirm page_name appears in header |
| 24h banner appears | METAINBOX-05 | Requires conversation with window_expired=true | Manually set window_expired in DB, confirm banner appears |
| Pause/resume bot | METAINBOX-06 | Requires live automation to verify automation stops | Click Pause, send test Meta message, confirm no automation fires |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

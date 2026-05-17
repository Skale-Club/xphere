---
phase: 22
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npm run build` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** `npm run build` (catches TypeScript errors from new types and actions)
- **After every plan wave:** `npx vitest run`
- **Before `/gsd:verify-work`:** `npm run build` green + `npx vitest run` green (151 tests baseline)
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 22-01-01 | 01 | 1 | CHANNEL-01, CHANNEL-05 | build | `npm run build` | `supabase/migrations/026_manychat_foundation.sql` | ⬜ pending |
| 22-01-02 | 01 | 1 | CHANNEL-01, CHANNEL-05 | build | `npm run build` | `src/types/database.ts` | ⬜ pending |
| 22-02-01 | 02 | 2 | CHANNEL-01, CHANNEL-05 | build | `npm run build` | `src/app/(dashboard)/integrations/manychat/actions.ts` | ⬜ pending |
| 22-02-02 | 02 | 2 | WEBHOOK-01..04 | build + suite | `npm run build && npx vitest run` | `src/app/api/manychat/webhook/route.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/manychat/webhook.test.ts` — test stubs for webhook handler (valid secret → 200 + log, invalid → 403, missing → 403)
- [ ] `tests/manychat/channel-actions.test.ts` — test stubs for createManychatChannel, deleteManychatChannel

*Check `tests/` directory for existing patterns before writing fixtures.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| API key stored encrypted, only hint returned | CHANNEL-01 | Requires live DB query | After createManychatChannel, query DB — verify `encrypted_api_key` starts with `iv:` format; verify UI only receives key_hint |
| webhook_secret is unique per org | CHANNEL-01 | DB constraint check | Create two channels (different orgs) — verify distinct webhook_secret values |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

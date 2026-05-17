---
phase: 8
slug: reviews-admin
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-04
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose tests/reviews` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose tests/reviews`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + `npm run build` clean
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 0 | GREV-01,02,03,04,05 | unit stub | `npx vitest run tests/reviews` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | GREV-01 | integration | `npx vitest run tests/reviews/locations` | ✅ | ⬜ pending |
| 08-02-02 | 02 | 1 | GREV-02,03,05 | integration | `npx vitest run tests/reviews/sync` | ✅ | ⬜ pending |
| 08-03-01 | 03 | 2 | GREV-01..05 | e2e build | `npm run build` | ✅ | ⬜ pending |
| 08-03-02 | 03 | 2 | GREV-04 | manual | see Manual Verifications | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/reviews/locations.test.ts` — stubs for GREV-01 (register location, validation)
- [ ] `tests/reviews/sync.test.ts` — stubs for GREV-02 (fetch reviews), GREV-03 (manual refresh), GREV-05 (24h cooldown)

*Wave 0 creates RED stubs before implementation so executor gets immediate feedback.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard renders locations list with sync status | GREV-04 | UI rendering — needs browser | Open /reviews, verify table shows name, last sync, review count, error column |
| Sync button fires and populates reviews within 10s | GREV-02,03 | Network + timing — needs real API key | Click Sync on a registered location, verify reviews appear with author names and stars |
| 24h cooldown rejection message shown | GREV-05 | UI state — needs browser | Click Sync twice in quick succession, verify rejection message appears |
| Google API key never in browser network tab | GREV-02 | Security — needs DevTools | Open Network tab, trigger sync, verify no request to places.googleapis.com from browser |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

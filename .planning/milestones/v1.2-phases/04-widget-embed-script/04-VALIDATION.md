---
phase: 4
slug: widget-embed-script
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | `vitest.config.ts` (environment: 'node'; widget tests use per-file jsdom override) |
| **Quick run command** | `npx vitest run tests/widget-asset.test.ts tests/widget.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/widget-asset.test.ts tests/widget.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + manual browser smoke test (`public/widget-test.html`)
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-W0-01 | 04-01 | 0 | WIDGET-01 | build smoke | `npx vitest run tests/widget-asset.test.ts` | ✅ (needs update) | ⬜ pending |
| 4-W0-02 | 04-01 | 0 | WIDGET-02..05 | unit (jsdom) | `npx vitest run tests/widget.test.ts` | ❌ W0 | ⬜ pending |
| 4-W1-01 | 04-02 | 1 | WIDGET-01,02 | build + unit | `npx vitest run tests/widget-asset.test.ts tests/widget.test.ts` | ✅/❌ | ⬜ pending |
| 4-W1-02 | 04-02 | 1 | WIDGET-03 | unit (jsdom) | `npx vitest run tests/widget.test.ts` | ❌ W0 | ⬜ pending |
| 4-W1-03 | 04-02 | 1 | WIDGET-04,05 | unit + integration | `npx vitest run tests/widget.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/widget-asset.test.ts` — update existing: remove `toContain('// Leaidear widget')` (stripped by minify); add assertion file is non-empty and contains `leaidear` string (survives minification in CSS classes and localStorage key)
- [ ] `tests/widget.test.ts` — new file with `// @vitest-environment jsdom` covering WIDGET-02 through WIDGET-05 (currentScript token extraction, Shadow DOM bubble/panel render, session localStorage read/write, unauthenticated API call)
- [ ] `public/widget-test.html` — manual HTML smoke test page (not Vitest; used for Phase gate browser verification)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Widget appears on real third-party HTML page | WIDGET-01 | jsdom can't simulate real cross-origin host page | Open `public/widget-test.html` in browser; confirm bubble appears bottom-right |
| Script tag is GTM-compatible (async, no render blocking) | WIDGET-02 | GTM environment can't be simulated in unit tests | Add script via GTM preview mode or manually with `async` attribute; confirm page renders before widget |
| Typing dots appear and full response renders on done | WIDGET-03 | Animation timing requires real browser | Load widget-test.html, send a message, observe dots then full response |
| Cross-origin POST succeeds from host page | WIDGET-05 | CORS requires real cross-origin request | Load widget-test.html on a different port (e.g. live-server on :5500); verify API call succeeds |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

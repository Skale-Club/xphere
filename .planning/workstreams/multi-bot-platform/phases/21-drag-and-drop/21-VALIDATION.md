---
phase: 21
slug: drag-and-drop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 21 — Validation Strategy

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

- **After every task commit:** `npm run build` (catches TypeScript errors from new actions and component props)
- **After every plan wave:** `npx vitest run`
- **Before `/gsd:verify-work`:** `npm run build` green + `npx vitest run` green (151 tests baseline)
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | FOLDER-04 | build | `npm run build` | `src/app/(dashboard)/tools/actions.ts` | ⬜ pending |
| 21-01-02 | 01 | 1 | MOVE-01, MOVE-02 | build | `npm run build` | `src/app/(dashboard)/tools/actions.ts` | ⬜ pending |
| 21-02-01 | 02 | 2 | FOLDER-04, MOVE-01, MOVE-02 | build | `npm run build` | `src/components/tools/tools-table.tsx` | ⬜ pending |
| 21-02-02 | 02 | 2 | MOVE-01, MOVE-02 | full suite | `npx vitest run` | existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing test infrastructure covers all phase requirements. No new test files needed — `tests/tools/actions.test.ts` already has todo stubs and will be extended in Wave 1.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drag folder header to new position — order persists after reload | FOLDER-04 | DnD interaction + page reload check | Drag folder header, drop in new position, reload page, verify order unchanged |
| Dragging tool over folder header shows highlight ring | MOVE-02 | CSS visual state during drag | Start dragging a tool row, hover over folder header, verify `ring-1 ring-primary/40 bg-primary/10` appears |
| Drop tool on folder header — tool moves immediately | MOVE-01 | DOM interaction | Drop tool onto folder header, verify tool appears under new folder without page reload |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

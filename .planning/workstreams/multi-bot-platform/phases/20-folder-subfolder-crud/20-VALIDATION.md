---
phase: 20
slug: folder-subfolder-crud
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 20 — Validation Strategy

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

- **After every task commit:** Run `npm run build` (catches TypeScript errors immediately)
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** `npm run build` green + `npx vitest run` green (151 tests passing baseline)
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | FOLDER-03, SUBFOLDER-03 | build | `npm run build` | `src/app/(dashboard)/tools/actions.ts` | ⬜ pending |
| 20-01-02 | 01 | 1 | DISPLAY-01, DISPLAY-02 | build | `npm run build` | `src/components/tools/tools-table.tsx` | ⬜ pending |
| 20-02-01 | 02 | 2 | FOLDER-01, SUBFOLDER-01 | build | `npm run build` | `src/components/tools/tools-table.tsx` | ⬜ pending |
| 20-02-02 | 02 | 2 | FOLDER-02, SUBFOLDER-02 | build | `npm run build` | `src/components/tools/tools-table.tsx` | ⬜ pending |
| 20-03-01 | 03 | 3 | FOLDER-03, SUBFOLDER-03 | build | `npm run build` | `src/components/tools/tools-table.tsx` | ⬜ pending |
| 20-03-02 | 03 | 3 | DISPLAY-01, DISPLAY-02 | full suite | `npx vitest run` | existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no new test files needed. Phase 20 is UI-only; the `tests/tools/actions.test.ts` stub from Phase 19 covers server action testing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Click folder label → input appears, Enter saves, Escape cancels | FOLDER-02, SUBFOLDER-02 | DOM interaction, no automated test | Render `/tools`, click folder name, verify input appears; type new name + Enter; verify label updates |
| (+) button appears on folder header hover | SUBFOLDER-01 | CSS hover state | Render `/tools`, hover over folder header, verify (+) button appears |
| AlertDialog shows two options on delete | FOLDER-03, SUBFOLDER-03 | Modal interaction | Click delete on a folder, verify modal has "Move tools to Ungrouped" and "Delete folder and tools" |
| Subfolder appears nested under parent | DISPLAY-01 | Visual nesting | Create subfolder, verify it renders indented under parent folder section |
| Ungrouped tools appear at bottom | DISPLAY-02 | Visual position | Ensure tools without folder_id render in "Ungrouped" section below named folders |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

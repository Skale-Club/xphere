---
phase: 19
slug: db-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 19 — Validation Strategy

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

- **After every task commit:** Run `npm run build` (catches TypeScript errors from schema changes immediately)
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** `npm run build` green + migration applied cleanly + `npx vitest run` green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | SC-1 | migration | `npx supabase db push` exits 0 | migration file | ⬜ pending |
| 19-01-02 | 01 | 1 | SC-4 | build | `npm run build` exits 0 | `src/types/database.ts` | ⬜ pending |
| 19-02-01 | 02 | 2 | SC-3 | unit | `npx vitest run tests/tools/` | ❌ Wave 0 | ⬜ pending |
| 19-02-02 | 02 | 2 | SC-2 | build | `npm run build` exits 0 | `src/app/(dashboard)/tools/actions.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/actions.test.ts` — unit tests for `getFolders`, `createFolder`, `updateFolder`, `deleteFolder` server actions (check existing `tests/` patterns before creating fixtures)

*Check `tests/` directory for existing mock/setup patterns before writing new fixtures.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Existing tools retain folder assignment | SC-2 | Requires live DB query post-migration | After `npx supabase db push`, run: `SELECT COUNT(*) FROM tool_configs WHERE folder_id IS NULL AND organization_id IN (SELECT id FROM organizations WHERE tool_folder_order IS NOT NULL)` — expect 0 |
| `tool_folders` table has correct RLS | SC-1 | DB-level policy enforcement | Verify in Supabase dashboard: `tool_folders` has `org_isolation` policy with `FOR ALL` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

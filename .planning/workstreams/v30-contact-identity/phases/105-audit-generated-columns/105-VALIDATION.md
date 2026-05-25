---
phase: 105
slug: audit-generated-columns
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 105 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (existing) + SQL queries via supabase MCP |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm run build` (type check gate after type regen) |
| **Full suite command** | `npm run lint && npm run build` |
| **Estimated runtime** | ~60-90 seconds |

DB validation is via direct `mcp__supabase_mcp_xphere__execute_sql` queries — no migration test framework exists yet in repo. Plan must include explicit SQL assertion queries in acceptance criteria.

---

## Sampling Rate

- **After every task commit:** Run `npm run build` if TS files touched; SQL assertion query if migration touched
- **After every plan wave:** Run `npm run build` full
- **Before `/gsd:verify-work`:** `npm run build` green + all SQL assertion queries return expected rows
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

To be filled by planner. Each task touching SQL gets an `execute_sql` assertion query in `<acceptance_criteria>`; each task touching TS gets `npm run build` exit 0.

---

## Wave 0 Requirements

None — vitest + supabase MCP infra already installed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Supabase branch promotion to main | CID-04 (migration approach) | MCP tool is interactive when tier-limited | Verify via `list_branches` before and after promote |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: SQL assertion after every migration task
- [ ] Wave 0 not needed
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

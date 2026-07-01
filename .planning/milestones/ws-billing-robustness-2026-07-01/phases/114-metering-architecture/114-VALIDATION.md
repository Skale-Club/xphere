---
phase: 114
slug: metering-architecture
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-01
---

# Phase 114 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (per CLAUDE.md `tests/` — Vitest tests) |
| **Config file** | Check `vitest.config.*` at repo root during planning |
| **Quick run command** | `npm run build` (type-check gate; no dedicated unit suite exists yet for this subsystem) |
| **Full suite command** | Check `package.json` scripts during planning |
| **Estimated runtime** | ~30-60s for `npm run build` |

---

## Sampling Rate

- **After every task commit:** Run `npm run build` — critical since RPC Args/Returns types and ledger Row types are changing
- **After every plan wave:** Manual smoke test of a Copilot turn end-to-end (send message → verify ledger row with `reason = 'copilot_turn'` appears with correct `amount_usd`/`balance_after`)
- **Before `/gsd:verify-work`:** `npm run build` green + manual ledger inspection confirming no regression in draw-down order or fail-open behavior
- **Max feedback latency:** ~60 seconds (build time)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 114-01-01 | 01 | 1 | MET-01 | build | `npm run build` | ✅ | ⬜ pending |
| 114-01-02 | 01 | 1 | MET-02 | build + manual | `npm run build` | ✅ | ⬜ pending |
| 114-01-03 | 01 | 1 | MET-03 | manual verification | Manual: exercise a real Copilot turn, compare ledger row shape before/after | ❌ deferred to Phase 116 (BTC-03) for automated coverage | ⬜ pending |
| 114-01-04 | 01 | 1 | MET-04 | manual review | N/A — doc/comment review | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* No test file exists yet for `src/lib/billing/credits.ts` or the `debit_copilot_credits` RPC — this is a deliberate deferral to Phase 116 (BTC-03), not a Wave 0 gap to fill in this phase.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Copilot debit behavior unchanged after refactor (draw-down order, insufficient-balance handling, ledger writes) | MET-03 | No automated regression suite exists yet for this subsystem — automated coverage is deliberately deferred to Phase 116 (BTC-03), sequenced after this phase so tests assert against the post-refactor call shape | Exercise a real Copilot turn in dev (with `BILLING_ENFORCEMENT_ENABLED` on if feasible), inspect the resulting `copilot_credit_ledger` row and `copilot_credit_balances` before/after values, compare against pre-refactor behavior documented in research |
| Doc/comment on the metering interface is present and accurate | MET-04 | Documentation quality is a manual review item, not machine-checkable | Read the interface's doc comment, confirm it names the required tag param and describes return/throw shape |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (build) or documented manual verification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (build) or manual gate
- [x] Wave 0 covers all MISSING references — N/A, no gaps this phase
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Waiver note:** Task 3's automated RPC verify is deliberately `MISSING` — BTC-03 (Phase 116) is sequenced after this phase specifically so automated RPC tests assert against this phase's post-refactor call shape, not a pre-refactor one (see STATE.md decision log and RESEARCH.md). The manual ledger-inspection checkpoint in Task 3 is accepted as the substitute gate for this phase. This is a reviewed, explicit waiver, not an oversight.

**Approval:** approved 2026-07-01

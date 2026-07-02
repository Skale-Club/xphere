---
phase: 116
slug: billing-test-coverage
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-01
---

# Phase 116 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 (`vitest.config.ts`: `environment: 'node'`, `globals: true`, setup file `tests/setup/load-env.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/billing-webhook.test.ts tests/billing-entitlements-unit.test.ts tests/billing-credit-rpcs.test.ts tests/billing-checkout-sessions.test.ts` |
| **Full suite command** | `npm test` (runs `vitest run` — entire `tests/**/*.test.ts` glob) |
| **Estimated runtime** | ~15-30s for the four billing test files |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <specific new/modified test file>`
- **After every plan wave:** `npm test` (full suite — confirms no cross-file mock leakage, e.g. global `process.env` pollution between billing test files)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 116-01-01 | 01 | 1 | BTC-01 | unit (real HMAC signature + mocked Supabase/Stripe subscriptions.retrieve) | `npx vitest run tests/billing-webhook.test.ts` | ❌ W0 | ⬜ pending |
| 116-01-02 | 01 | 1 | BTC-03 | unit (mocked `supabase.rpc()`) | `npx vitest run tests/billing-credit-rpcs.test.ts` | ❌ W0 | ⬜ pending |
| 116-01-03 | 01 | 1 | BTC-04 | unit (mocked `getStripe`/`getOrCreateStripeCustomer`/`getBillingContext`) | `npx vitest run tests/billing-checkout-sessions.test.ts` | ❌ W0 | ⬜ pending |
| 116-01-04 | 01 | 1 | BTC-02 | unit audit (extend existing file only if gap found) | `npx vitest run tests/billing-entitlements-unit.test.ts` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/billing-webhook.test.ts` — covers BTC-01 (new file)
- [ ] `tests/billing-credit-rpcs.test.ts` — covers BTC-03 (new file)
- [ ] `tests/billing-checkout-sessions.test.ts` — covers BTC-04 (new file)
- [ ] Audit `tests/billing-entitlements-unit.test.ts` for BTC-02 completeness — extend only if the audit finds a genuinely missing precedence case
- No framework install needed — Vitest, `stripe`, and `@supabase/supabase-js` are all already present as dependencies

---

## Manual-Only Verifications

*All phase behaviors have automated verification.* This phase's entire purpose is automated test coverage; there is no manual-only aspect.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Note on BTC-03's scope:** Mocking `supabase.rpc()` verifies the JS wrapper's call contract (arguments passed, response handling), not the SQL function body's actual correctness — that substantive behavior was already verified in Phase 114 via a live rolled-back transaction against the real RPC. This phase's BTC-03 tests are a regression guard for the call-site contract going forward, not a re-verification of the RPC's SQL logic. Documented here, not hidden.

**Approval:** approved 2026-07-01

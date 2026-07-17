---
phase: 132
slug: medusa-provider-read-tools
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 132 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo standard; `tests/**` only) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/medusa-client.test.ts tests/medusa-actions.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick < 10s (mocked fetch + supabase) |

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every plan wave:** quick run + `npm run build` (type gate — catches enum-union edits to database.ts)
- **Before verify-work:** `npm test` + `npm run build` green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (planner fills) | | | MED-01 | static | `grep "'medusa'" supabase/migrations/1259_medusa_integration.sql`; `npm run build` (database.ts enum unions edited) | ❌ | ⬜ |
| (planner fills) | | | MED-02 | static+build | registry.ts medusa entry; `IntegrationForDisplay.provider` union includes 'medusa' | ❌ | ⬜ |
| (planner fills) | | | MED-03 | unit | vitest: search/get_product/get_cart executors — happy, region fallback, store-not-connected, R11 breach, 8s timeout; cart id from pinned ctx only (no id param) | ❌ W0 | ⬜ |
| (planner fills) | | | MED-04 | unit+static | vitest: both executeAction call sites pass conversationId; ACTION_DESCRIPTIONS + spec.ts NODES grep | ❌ | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/medusa-client.test.ts` — stubs for the store fetch client (x-publishable-api-key header, 8s AbortSignal.timeout, R11 rate-limit key `medusa:org:{orgId}` 120/60 memory) with `fetch` + `@/lib/redis`/`@/lib/rate-limit` mocked
- [ ] `tests/medusa-actions.test.ts` — stubs for the 3 executors (mock the client + supabase conversation lookup)
- (vitest infra already present — no install)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Integrations UI round-trip (save Medusa creds, encrypted, decrypt on read) | MED-02 | Needs the dashboard + Supabase; encryption round-trip is E2E | In the Integrations UI, add a Medusa integration (Server URL, Publishable Key, Connection Token), save, reload → fields persist; DB `integrations.encrypted_api_key` is ciphertext |
| Live product answer with region price | MED-03 | Needs a running Medusa store + connected org | Ask the agent "what hoodies do you have?" on the wired storefront → region-correct prices (E2E wiring pass) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

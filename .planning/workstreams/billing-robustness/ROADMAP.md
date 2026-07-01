# Roadmap: billing-robustness (v3.2 Credits Visibility & Metering Architecture)

## Overview

Stripe billing, subscriptions, entitlements, and the Copilot credit wallet (included + topup buckets, ledger, atomic RPCs) already shipped and are production-ready. This milestone hardens that foundation rather than rebuilding it: it makes credit balance visible to users, generalizes the credit-debit path into a reusable interface any future feature can plug into, backfills automated test coverage across the billing surface, and closes the observability gap so webhook/debit failures are no longer silent. No new feature is wired to actually debit credits yet — Copilot remains the only debiting feature by design.

## Phases

**Phase Numbering:**
Continues from the prior milestone (v3.1 Websites Lead Ingestion ended at phase 113). This milestone starts at 114.

- [ ] **Phase 114: Metering Architecture** - Generic, reason-tagged credit-debit interface; Copilot refactored onto it with no behavior change
- [ ] **Phase 115: Credit Balance Visibility** - Persistent, live-updating credit balance indicator in the global sidebar/header
- [ ] **Phase 116: Billing Test Coverage** - Automated tests for Stripe webhooks, entitlements resolution, credit RPCs, and checkout/top-up session creation
- [ ] **Phase 117: Billing Observability** - Queryable, admin-visible record of webhook and credit-debit failures instead of silent swallowing

## Phase Details

### Phase 114: Metering Architecture
**Goal**: Platform has a single reusable credit-debit interface, tagged by feature/reason, that any future feature (workflows, campaigns, calls) can plug into later without redesign — with Copilot migrated onto it today with zero behavior change.
**Depends on**: Nothing (first phase of this milestone; builds on existing production credit wallet/RPCs)
**Requirements**: MET-01, MET-02, MET-03, MET-04
**Success Criteria** (what must be TRUE):
  1. A single exported function/module accepts a feature/reason tag (e.g. `copilot_turn`, future `workflow_run`) and performs the dual-bucket credit debit through it — there is no second, parallel debit code path
  2. Every credit ledger entry written through this interface records which feature/reason triggered it, visible when inspecting the ledger table
  3. The existing Copilot debit call site is refactored to call through this interface, and Copilot's debiting behavior (draw-down order, insufficient-balance handling, ledger writes) is unchanged from before the refactor
  4. A code comment or short doc alongside the interface explains what a new feature must do to hook into metering (what tag to use, what the interface returns/throws)
**Plans**: 1 plan

Plans:
- [ ] 114-01-PLAN.md — Add reason column + generic meterDebit() interface, refactor Copilot call site, manual verification

### Phase 115: Credit Balance Visibility
**Goal**: Users can see their org's credit balance at a glance from anywhere in the dashboard, with it staying current and guiding them toward billing when it matters.
**Depends on**: Phase 114 (reads from the confirmed metering/ledger data shape; not strictly blocking if the existing balance-read path is already clean, but sequenced after to reflect any ledger-shape changes)
**Requirements**: CRB-01, CRB-02, CRB-03, CRB-04
**Success Criteria** (what must be TRUE):
  1. On every dashboard page, an org whose plan includes credits sees a persistent balance indicator (included + topup) in the global sidebar/header
  2. After a Copilot turn debits credits, or after a top-up purchase completes, the indicator reflects the new balance without the user reloading the page
  3. An org without a credit-bearing plan sees the indicator hidden, or an appropriate empty state, instead of a broken/zero display
  4. When balance is low or zero, the indicator switches to a distinct visual state (color/badge) and is clickable through to the billing settings page
**Plans**: TBD
**UI hint**: yes

### Phase 116: Billing Test Coverage
**Goal**: The billing surface (checkout, webhooks, entitlements, credit RPCs) has an automated regression safety net so future changes — including this milestone's own metering refactor — can be verified without manual Stripe testing.
**Depends on**: Phase 114 (tests the debit RPC through its now-generic interface so assertions reflect the final call shape, not a pre-refactor one)
**Requirements**: BTC-01, BTC-02, BTC-03, BTC-04
**Success Criteria** (what must be TRUE):
  1. Running the test suite exercises the Stripe webhook handler for `checkout.session.completed` and subscription created/updated/deleted and invoice events, including a case proving duplicate event delivery is idempotent
  2. Running the test suite exercises entitlements resolution and proves the precedence order (`plan_override > subscription > trial > none`) with a case per precedence level
  3. Running the test suite exercises the credit debit/credit RPCs: dual-bucket draw-down order, ledger entry creation, and insufficient-balance behavior
  4. Running the test suite exercises checkout session and top-up session creation, asserting correct metadata and correct price IDs are sent
**Plans**: TBD

### Phase 117: Billing Observability
**Goal**: When billing fails — a Stripe webhook errors, or a credit debit silently fails open — the platform admin can see it happened without querying the database directly.
**Depends on**: Phase 114 (BOB-02 needs the generic debit interface as the single place to detect and record a distinct failure), Phase 116 (tests should cover the new failure-recording paths, so observability lands after the test-writing patterns are established) — soft dependency, can be reordered if needed
**Requirements**: BOB-01, BOB-02, BOB-03
**Success Criteria** (what must be TRUE):
  1. A Stripe webhook event that errors during processing is recorded somewhere queryable/alertable instead of disappearing after a caught exception
  2. A credit-debit RPC call that fails is recorded distinctly from the platform's existing fail-open behavior — the failure is visible even though the user-facing action still succeeded
  3. Platform admin can open an admin-panel view and see recent billing failures (both webhook and debit) without running a manual database query
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 114 → 115 → 116 → 117

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 114. Metering Architecture | 0/1 | Not started | - |
| 115. Credit Balance Visibility | 0/TBD | Not started | - |
| 116. Billing Test Coverage | 0/TBD | Not started | - |
| 117. Billing Observability | 0/TBD | Not started | - |

# Requirements: v3.2 Credits Visibility & Metering Architecture

**Defined:** 2026-07-01
**Core Value:** The Action Engine must work — when an AI assistant triggers a tool during a live interaction, the platform must identify the tenant, execute the business logic, and return a result fast enough for production flows.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Credit Balance Visibility (CRB)

- [ ] **CRB-01**: User sees a persistent credit balance indicator (included + topup) in the global sidebar/header on every dashboard page, when the org's plan includes credits
- [ ] **CRB-02**: Indicator updates without a full page reload after a debit or top-up (e.g. after a Copilot turn or a top-up purchase)
- [ ] **CRB-03**: Indicator is hidden or shows an appropriate empty state for orgs without a credit-bearing plan
- [ ] **CRB-04**: Indicator shows a distinct visual state (color/badge) when balance is low or zero, and is clickable through to the billing settings page

### Metering Architecture (MET)

- [x] **MET-01**: Platform has a single reusable credit-debit interface accepting a feature/reason tag (e.g. `copilot_turn`, future `workflow_run`)
- [x] **MET-02**: Credit ledger entries record which feature/reason triggered each debit, for auditability across future feature types
- [x] **MET-03**: Existing Copilot debit path is refactored to call through the new generic interface with no behavior change
- [x] **MET-04**: Documentation/code comment describes how a new feature should hook into the metering interface

### Billing Test Coverage (BTC)

- [ ] **BTC-01**: Automated tests cover the Stripe webhook handler (checkout.session.completed, subscription created/updated/deleted, invoice events) including idempotency
- [ ] **BTC-02**: Automated tests cover entitlements resolution precedence (plan_override > subscription > trial > none)
- [ ] **BTC-03**: Automated tests cover the credit debit/credit RPCs (dual-bucket draw-down order, ledger entry creation, insufficient-balance behavior)
- [ ] **BTC-04**: Automated tests cover checkout session and top-up session creation (correct metadata, correct price IDs)

### Billing Observability (BOB)

- [ ] **BOB-01**: A failed/errored Stripe webhook event is recorded in a queryable/alertable way instead of being silently swallowed
- [ ] **BOB-02**: A failed credit-debit RPC call is recorded distinctly from the existing fail-open behavior instead of disappearing silently
- [ ] **BOB-03**: Platform admin can see recent billing failures (webhook + debit) without querying the database directly

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Cross-Feature Metering (deferred)

- **MET-05**: Workflow executions debit org credits via the generic metering interface
- **MET-06**: Campaign/WhatsApp dispatch debits org credits via the generic metering interface
- **MET-07**: Vapi voice calls debit org credits via the generic metering interface
- **MET-08**: Low-balance alert/blocking UX (banner or modal) when an org tries to run a credit-consuming action at zero balance

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Wiring workflows/campaigns/calls to actually debit credits | Architecture-first milestone; user chose to design the reusable interface now and decide which features consume credits later |
| Rebuilding Stripe checkout/webhook/subscription foundation | Already production-ready (billing_customers, billing_subscriptions, billing_events — migration 1153); this milestone hardens it, does not replace it |
| Flipping `BILLING_ENFORCEMENT_ENABLED` on | Operational rollout decision, not a build task |
| Multi-currency / tax handling | Not raised as a current need |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CRB-01 | Phase 115 | Pending |
| CRB-02 | Phase 115 | Pending |
| CRB-03 | Phase 115 | Pending |
| CRB-04 | Phase 115 | Pending |
| MET-01 | Phase 114 | Complete |
| MET-02 | Phase 114 | Complete |
| MET-03 | Phase 114 | Complete |
| MET-04 | Phase 114 | Complete |
| BTC-01 | Phase 116 | Pending |
| BTC-02 | Phase 116 | Pending |
| BTC-03 | Phase 116 | Pending |
| BTC-04 | Phase 116 | Pending |
| BOB-01 | Phase 117 | Pending |
| BOB-02 | Phase 117 | Pending |
| BOB-03 | Phase 117 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15/15 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-01*
*Last updated: 2026-07-01 after roadmap creation (phases 114-117)*

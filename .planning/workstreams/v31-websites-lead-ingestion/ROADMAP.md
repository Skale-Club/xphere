# Roadmap: Xphere v3.1 Websites Lead Ingestion

## Overview

This milestone establishes Xphere as the secure receiving side of the optional sibling-product integration with Skale Club Websites. Xphere remains independently billable and derives organization identity exclusively from an organization-scoped API key.

## Phases

- [x] **Phase 111: API Security and Contract** - Add scopes, shared API-key verification, integration validation, and the versioned lead envelope. (completed 2026-06-21)
- [x] **Phase 112: Idempotent Lead Ingestion** - Add receipt persistence, contact upsert, idempotency, and organization isolation. (completed 2026-06-21)
- [x] **Phase 113: Workflow Event and Documentation** - Emit workflow events, expose variables, add audit coverage, and publish the final API contract. (completed 2026-06-21)

## Phase Details

### Phase 111: API Security and Contract
**Goal**: Establish a least-privilege and reusable public API authentication boundary before accepting lead data.
**Depends on**: Nothing
**Requirements**: XLI-01, XLI-02, XLI-03, XLI-04, XLI-05
**Success Criteria**:
1. `leads:write` appears in API-key management and can be granted independently.
2. Public API routes use one shared verifier that returns the key ID, organization ID, and scopes.
3. Contacts rejects a valid key without `contacts:write`.
4. Integration validation reveals only the minimum connection metadata.
5. Contract schemas and fixtures reject tenant-controlled organization IDs.

### Phase 112: Idempotent Lead Ingestion
**Goal**: Persist each Websites submission exactly once effectively while deduplicating CRM contacts independently.
**Depends on**: Phase 111
**Requirements**: XLI-06, XLI-07, XLI-08, XLI-09, XLI-10, XLI-11, XLI-12
**Success Criteria**:
1. The migration creates `lead_ingestions` with RLS and a unique external-event constraint.
2. Identical replay returns the original receipt and does not duplicate the contact.
3. Conflicting replay returns 409.
4. Two submissions from one phone or email create one contact and two receipts.
5. Organization A cannot address or read organization B data.

### Phase 113: Workflow Event and Documentation
**Goal**: Make accepted leads actionable through Xphere workflows and complete the operator-facing contract.
**Depends on**: Phase 112
**Requirements**: XLI-13, XLI-14, XLI-15, XLI-16, XLI-17
**Success Criteria**:
1. `lead.captured` is registered in the workflow spec and variable catalog.
2. Each unique receipt dispatches `lead.captured` once, including repeat inquiries.
3. `contact.created` fires only when a contact is newly inserted.
4. Workflow failures remain non-blocking and auditable.
5. Public documentation describes per-organization setup, scopes, idempotency, and errors.

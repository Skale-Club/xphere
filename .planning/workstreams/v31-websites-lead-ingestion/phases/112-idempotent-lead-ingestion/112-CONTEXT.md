# Phase 112: Idempotent Lead Ingestion - Context

## Goal

Preserve every unique submission while deduplicating CRM identity independently.

## Decisions

- `lead_ingestions` is an immutable receipt ledger protected by RLS.
- Uniqueness is `(org_id, source_product, external_event_id)`.
- A payload hash detects conflicting reuse of an idempotency key.
- Contact matching remains phone first, then email, inside one organization.

## Scope

Migration, generated database types, contact upsert service, route behavior, and race-safe replay handling.

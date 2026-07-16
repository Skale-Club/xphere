---
phase: 127-canonical-booking-lifecycle
plan: 08
status: complete
completed: 2026-07-16
requirements: [LIFE-01]
---

# Plan 127-08 Summary: Apply Migration 1251 to Production

## What Happened

Operator checkpoint executed by the orchestrator via Supabase MCP `apply_migration` against project `mwklvkmggmsintqcqfvu` (production CRM), after ALL code plans (127-01..07) had landed — no partial-rollout window.

1. **Applied `1251_booking_lifecycle_transition`:** `transition_booking_status(p_booking_id, p_org_id, p_new_status, p_allowed_from)` — SECURITY DEFINER plpgsql RPC with FOR UPDATE row lock, explicit org re-check (same `booking_not_found` error for cross-org probes), idempotent-transition short-circuit, and `illegal_transition` guard.
2. **Post-apply verification (SQL):** function exists, `prosecdef = true`, `service_role` has EXECUTE, zero grants to anon/authenticated/PUBLIC (mirrors migration 1208's lockdown).
3. **Real-DB suite against production:** `npx vitest run tests/calendar-lifecycle-rpc.test.ts` — **6/6 passed** (not soft-skipped).

## Notes

- MCP `apply_migration` records a timestamp-versioned ledger entry (accepted project-wide).
- The RPC existing ahead of app-code deploy is harmless: nothing calls it until the branch merges and deploys.

## Self-Check: PASSED

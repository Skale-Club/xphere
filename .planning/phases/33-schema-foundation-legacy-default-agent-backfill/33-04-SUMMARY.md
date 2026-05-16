---
phase: 33
plan: 04
subsystem: schema.idempotency-and-pricing
tags: [migration, idempotency, pricing, reference-data, rls, seed]
dependency-graph:
  requires: [33-01]
  provides:
    - public.tool_idempotency_keys (RLS-enabled, org-scoped)
    - public.agent_model_pricing (global reference, no RLS, 7 seed rows)
  affects:
    - Plan 33-07 (push: migration 038 lands among 034-040)
    - Phase 34 (cost calculator joins agent_invocations.model → agent_model_pricing)
    - Phase 38 (idempotency wrappers consume tool_idempotency_keys via runtime-derived sha256(agent_invocation_id + tool_call_index) keys)
tech-stack:
  added: []
  patterns:
    - RLS canonical policy (organization_id = (SELECT public.get_current_org_id())) for tool_idempotency_keys
    - Public reference table (no RLS, service-role-only writes via DB grants) for agent_model_pricing
    - PRIMARY KEY model TEXT (D-33-15) — natural unique key, no surrogate UUID
    - ON CONFLICT (model) DO NOTHING for idempotent seed
key-files:
  created:
    - supabase/migrations/038_tool_idempotency_and_pricing.sql
  modified: []
---

# Plan 33-04 Summary — Migration 038 (Idempotency Keys + Model Pricing)

## What shipped

**Migration 038 (`tool_idempotency_keys` + `agent_model_pricing`):**

- `public.tool_idempotency_keys` — org-scoped table to prevent double-execution of side-effecting tool calls. RLS enabled with canonical `(SELECT public.get_current_org_id())` policy. Composite UNIQUE on `(org_id, tool_id, idempotency_key)`. Phase 38 will write to it via runtime-derived `sha256(agent_invocation_id + tool_call_index)` keys; cleanup mechanism deferred per CONTEXT.md deferred ideas.

- `public.agent_model_pricing` — global reference table mapping LLM `model` strings to per-million-token USD prices. **No RLS** (public reference data); writes restricted via Postgres role grants (anon/authenticated have no DML by default). 7 launch model rows seeded via `INSERT ... ON CONFLICT (model) DO NOTHING`:
  - Anthropic: claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5
  - OpenAI: gpt-4o, gpt-4o-mini
  - Google: gemini-2.5-pro, gemini-2.5-flash

## Canonical column names honored

Per REQUIREMENTS.md OBS-03 and the iteration-2 plan-checker fix:
- `model TEXT PRIMARY KEY`
- `source TEXT NOT NULL` (provider attribution)
- `input_per_1m_usd NUMERIC(10,4)` with `CHECK >= 0`
- `output_per_1m_usd NUMERIC(10,4)` with `CHECK >= 0`
- `notes TEXT`
- `updated_at TIMESTAMPTZ DEFAULT now()`

## Decisions honored

- **D-33-01:** Migration 038 carries idempotency + pricing (separate from 039 which carries channel agent_id columns)
- **D-33-15:** `agent_model_pricing.model` is the PRIMARY KEY — no extra indexes needed
- Pricing rates as of 2026-05-16 — vendor pricing should be verified pre-push if execute time drifts >5%

## Commits

- `89bb2b8` — feat(33-04): add migration 038 tool_idempotency_keys + agent_model_pricing
- (closeout commit applied by orchestrator post-socket-error)

## Notes

Plan executor agent had a socket disconnect after the migration commit landed but before SUMMARY/STATE writes. Orchestrator reconstructed this SUMMARY from the on-disk migration file and the plan spec; verified migration 038 has 93 lines with correct columns, RLS policy on idempotency keys, no-RLS on pricing, and 7-row seed with ON CONFLICT DO NOTHING.

## Requirements addressed

OBS-03 (agent_model_pricing schema + seed)

## Verification

- `grep` checks confirm canonical column names (input_per_1m_usd, output_per_1m_usd, source)
- `grep` confirms RLS only on tool_idempotency_keys (line 32), absent on agent_model_pricing (line 67 documents "No RLS")
- `grep` confirms ON CONFLICT (model) DO NOTHING (line 93)
- Wave 2 reconciliation by orchestrator after all 4 sibling executors completed

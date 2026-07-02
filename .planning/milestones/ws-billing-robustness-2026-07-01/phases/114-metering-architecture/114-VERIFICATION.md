---
phase: 114-metering-architecture
verified: 2026-07-01T00:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 114: Metering Architecture Verification Report

**Phase Goal:** Platform has a single reusable credit-debit interface, tagged by feature/reason, that any future feature (workflows, campaigns, calls) can plug into later without redesign — with Copilot migrated onto it today with zero behavior change.
**Verified:** 2026-07-01
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A single exported function performs the dual-bucket credit debit for any feature, tagged by a reason parameter — there is no second, parallel debit code path | VERIFIED | `src/lib/billing/credits.ts:123` exports `meterDebit(orgId, reason: MeterReason, costUsd, refId?)`. `debitCopilot` no longer exists anywhere in the codebase — confirmed by `grep -rn "debitCopilot" src/` (zero matches) and by direct read of `credits.ts` full contents (212 lines, single debit export). |
| 2 | A ledger row written through this interface records which feature/reason triggered it (reason column, non-null when the interface passes a tag) | VERIFIED | Migration `1225_metering_reason.sql` adds nullable `reason text` column to `copilot_credit_ledger` and threads `p_reason` into the RPC's `INSERT INTO public.copilot_credit_ledger (..., reason) VALUES (..., p_reason)`. Confirmed live on the remote DB via direct PostgREST introspection (see Data-Flow Trace below) — not just present in the migration file. |
| 3 | Copilot's debit call site now calls through the generic interface, and its draw-down order, insufficient-balance handling, and ledger-write shape are byte-for-byte unchanged from before the refactor | VERIFIED | `src/lib/copilot/run-turn.ts:16` imports `meterDebit`; line 141 calls `meterDebit(input.orgId, 'copilot_turn', costUsd, runId)`. The RPC body in `1225_metering_reason.sql` is byte-for-byte identical to the pre-refactor `1208_copilot_credits.sql` version except the added trailing `p_reason` param and its pass-through — draw-down math (`v_take_inc`, `v_inc`, `v_top`, `v_total`), `FOR UPDATE` lock, and `RETURN jsonb_build_object(...)` shape all unchanged. Manually verified via a rolled-back transactional test against the live DB (documented in SUMMARY, evidence reproduced below) confirming fail-open/draw-down semantics hold with the new signature. |
| 4 | A future feature author can read a doc comment on the interface and know what tag to pass, what the function returns, and how it fails | VERIFIED | `credits.ts` lines 11-34: doc comment on `MeterReason` gives an explicit 4-step hook-in guide (add tag to union; call `meterDebit` post-hoc; fail-open contract — never throws; `refId`/`copilot_run_id` FK caveat for non-Copilot run IDs). JSDoc on `meterDebit` itself (lines 112-121) restates the fail-open contract and explicitly flags this as "the SINGLE reusable credit-debit interface (MET-01)". |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/1225_metering_reason.sql` | New nullable `reason` column + `p_reason` RPC param + re-issued grants | VERIFIED | File exists (76 lines). Contains `ALTER TABLE public.copilot_credit_ledger ADD COLUMN IF NOT EXISTS reason text`, `p_reason text DEFAULT NULL` as 4th RPC param, ledger insert threading `reason`, and both `REVOKE ALL ... (uuid, numeric, uuid, text)` / `GRANT EXECUTE ... TO service_role` against the new 4-arg signature. |
| `src/lib/billing/credits.ts` | Generic `meterDebit()` export with `MeterReason` union and hook-in doc comment; `debitCopilot` removed | VERIFIED | `export type MeterReason = 'copilot_turn'` (line 34) and `export async function meterDebit(...)` (line 123) both present. `debitCopilot` fully absent (grep confirms zero occurrences repo-wide). `CreditLedgerEntry`/`getCopilotLedger()` additively expose `reason` for the billing settings read path. |
| `src/lib/copilot/run-turn.ts` | Debit call site refactored to `meterDebit(orgId, 'copilot_turn', costUsd, runId)` | VERIFIED | Import (line 16) and call site (line 141) both confirmed via direct read; surrounding `copilot_runs` status update and return shape untouched (diff-equivalent to PLAN's Step C instructions). |
| `src/types/database.ts` | `copilot_credit_ledger` Row/Insert/Update include `reason`; `debit_copilot_credits` Args include `p_reason` | VERIFIED | Lines 700-738: `reason: string | null` (Row), `reason?: string | null` (Insert, Update). Lines 7482-7485: `Args: { p_org_id: string; p_amount_usd: number; p_run_id?: string | null; p_reason?: string | null }`. Matches PLAN's exact required shape. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/lib/copilot/run-turn.ts` | `src/lib/billing/credits.ts` | `import { meterDebit } from '@/lib/billing/credits'` | WIRED | Import present at line 16; `meterDebit(input.orgId, 'copilot_turn', costUsd, runId)` called at line 141 — this is the only caller of `meterDebit` in the codebase (confirmed via grep). |
| `src/lib/billing/credits.ts` | `debit_copilot_credits` RPC | `supabase.rpc('debit_copilot_credits', { ..., p_reason })` | WIRED | `meterDebit` body (lines 130-144) calls `supabase.rpc('debit_copilot_credits', { p_org_id, p_amount_usd, p_run_id, p_reason: reason })` — `p_reason: reason` present exactly as required. |
| `debit_copilot_credits` RPC | `copilot_credit_ledger` | `INSERT INTO public.copilot_credit_ledger (..., reason) VALUES (..., p_reason)` | WIRED | Migration line 65-66: `INSERT INTO public.copilot_credit_ledger (org_id, kind, amount_usd, balance_after, copilot_run_id, reason) VALUES (p_org_id, 'debit', -p_amount_usd, v_total, p_run_id, p_reason)`. Confirmed live on remote DB (see Data-Flow Trace). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `debit_copilot_credits` RPC (remote, project `mwklvkmggmsintqcqfvu`) | `reason` column / `p_reason` param | Live PostgREST introspection: `GET /rest/v1/copilot_credit_ledger?select=reason&limit=1` returned HTTP 200 (empty array — table has no rows yet, consistent with SUMMARY's note that no org had triggered a billed turn in production at verification time; a 400 would indicate a missing column). `GET /rest/v1/` (OpenAPI spec) shows `paths['/rpc/debit_copilot_credits'].post.parameters[0].schema.properties` includes `p_reason: {format: text, type: string}` alongside `p_org_id`, `p_amount_usd`, `p_run_id` — confirming the live RPC signature genuinely has 4 params, not just the migration file on disk. | Yes — confirmed against the live remote schema, independent of the migration file | FLOWING |

**Note on migration bookkeeping:** `npx supabase migration list` shows local migrations `1224` and `1225` with a blank "Remote" column, meaning the CLI's `supabase_migrations.schema_migrations` history table has no row for them. This is because the SUMMARY documents these were applied via the Supabase Management API's `apply_migration` (direct SQL execution) rather than `npx supabase db push`, due to a local CLI auth failure (403) against this project ref. The actual schema change is confirmed live via direct PostgREST introspection above — this is ground truth independent of the CLI's bookkeeping table. Flagged as an informational anti-pattern below (CLI migration history is now out of sync with reality for these two migrations), not a functional gap.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|-------------|--------------|--------|----------|
| MET-01 | 114-01-PLAN.md | Platform has a single reusable credit-debit interface accepting a feature/reason tag | SATISFIED | `meterDebit(orgId, reason, costUsd, refId)` is the only exported debit function in `credits.ts`, generic over `MeterReason`; `debitCopilot` fully removed, zero remaining references. |
| MET-02 | 114-01-PLAN.md | Credit ledger entries record which feature/reason triggered each debit | SATISFIED | `copilot_credit_ledger.reason` column exists (confirmed live), populated by `p_reason` on every debit through `meterDebit`. Scoped correctly to the debit path only (grant/reset RPCs intentionally untouched, per RESEARCH.md Pitfall 3). |
| MET-03 | 114-01-PLAN.md | Existing Copilot debit path refactored to call through the generic interface with no behavior change | SATISFIED | `run-turn.ts` calls `meterDebit(input.orgId, 'copilot_turn', costUsd, runId)`; RPC draw-down/fail-open logic byte-for-byte preserved. Manual verification (Task 3 checkpoint) performed by the orchestrating session via a rolled-back SQL transaction against the live DB, confirming correct draw-down order, fail-open behavior, and reason tagging — documented in 114-01-SUMMARY.md "Manual Verification" section. Treated as completed evidence per task instructions (automated RPC coverage deliberately deferred to Phase 116/BTC-03). |
| MET-04 | 114-01-PLAN.md | Documentation/code comment describes how a new feature should hook into the metering interface | SATISFIED | `MeterReason` doc comment (credits.ts lines 11-33) gives an explicit 4-step hook-in guide; `meterDebit` JSDoc restates the fail-open contract and identifies itself as the single interface. |

No orphaned requirements — all four IDs in REQUIREMENTS.md's MET section map to this phase's plan and are covered above. REQUIREMENTS.md itself already shows all four as `[x]` checked and "Complete" in the traceability table, consistent with this verification.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| N/A (CLI bookkeeping, not source) | — | `npx supabase migration list` shows migrations 1224/1225 with no "Remote" entry, because they were applied via direct Management API SQL execution rather than `db push` | Info | Cosmetic drift between local CLI migration history and reality. The actual schema change is live and correct (confirmed via PostgREST introspection). Future `npx supabase db push` runs from a properly authenticated CLI session could attempt to re-apply 1224/1225; since both use `ADD COLUMN IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION`, a re-run would be a no-op, not a failure — low risk, but worth a note for whoever next runs `db push` in an authenticated session. |
| `src/lib/billing/credits.ts` | 34 | `MeterReason` implemented as a plain string-literal union rather than the `as const` array + derived type convention used in `catalog.ts` | Info | Stylistic deviation from RESEARCH.md's suggested pattern, not a functional issue — with only one reason value today, a plain union is equivalent and still fully extensible/generic per MET-01/MET-04. |

No blocker or warning-level anti-patterns found. No TODO/FIXME/placeholder markers, no stub returns, no hardcoded empty responses in any of the four modified files.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full `npm run build` (webpack compile + TypeScript type-check + route generation + postbuild `verify-sw` guard) | `npm run build` (re-run with `NODE_OPTIONS=--max-old-space-size=6144` after an earlier concurrent-build OOM) | Exit code 0. `✓ Compiled successfully`, full route manifest generated for all dashboard/API routes (including `/settings/billing`), `[verify-sw] OK — public/sw.js generated (82.7 KB)` | PASS |
| Live remote RPC has the new 4-arg signature with `p_reason` | Direct PostgREST OpenAPI introspection (`GET {SUPABASE_URL}/rest/v1/`) via service-role key | `paths['/rpc/debit_copilot_credits'].post.parameters[0].schema.properties` includes `p_reason: {format: text, type: string}` | PASS |
| Live remote `copilot_credit_ledger` has the `reason` column | Direct REST query (`GET {SUPABASE_URL}/rest/v1/copilot_credit_ledger?select=reason&limit=1`) via service-role key | HTTP 200, `[]` (no rows yet, but no column-not-found error) | PASS |
| No orphaned `debitCopilot` references remain anywhere in `src/` | `grep -rn "debitCopilot" src/` | Zero matches | PASS |

**Note on the first build attempt:** An initial `npm run build` run hit a `JavaScript heap out of memory` crash during the TypeScript compiler pass, caused by a second build process running concurrently in the same session (confirmed by a subsequent invocation immediately erroring with "Another next build process is already running"). Re-running in isolation with a larger heap (`--max-old-space-size=6144`) completed cleanly end-to-end, confirming this was transient environment memory pressure, not a type error introduced by this phase.

### Human Verification Required

None. Task 3's human-verify checkpoint was already completed by the orchestrating session (documented in 114-01-SUMMARY.md "Manual Verification (Task 3 checkpoint — MET-03)" via a rolled-back transactional test against the live database), and is treated as completed evidence per the phase's explicit design (automated RPC test coverage deliberately deferred to Phase 116/BTC-03, not an outstanding gap of this phase).

### Gaps Summary

No gaps found. All four observable truths verified, all four required artifacts pass all three wiring levels (exist, substantive, wired) plus the Level 4 data-flow trace against the live remote database, all three key links confirmed wired, all four requirement IDs (MET-01 through MET-04) satisfied with direct evidence, and a full clean `npm run build` (webpack + tsc + route generation + postbuild SW guard) passed with exit code 0.

---

*Verified: 2026-07-01*
*Verifier: Claude (gsd-verifier)*

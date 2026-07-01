# Phase 114: Metering Architecture - Research

**Researched:** 2026-07-01
**Domain:** Internal refactor — generic credit metering interface over existing Postgres RPCs (Supabase/PostgreSQL, TypeScript service layer)
**Confidence:** HIGH

## Summary

This is a pure internal-refactor phase with no external library research required. The production credit wallet (`copilot_credit_balances` + `copilot_credit_ledger`, migration `1208_copilot_credits.sql`) and its TypeScript facade (`src/lib/billing/credits.ts`) already implement dual-bucket draw-down (included-then-topup), fail-open debiting, and an append-only ledger. The gap versus MET-01..04 is narrow and mechanical:

1. The ledger's `kind` column is a constrained enum (`monthly_reset|topup|grant|debit`) — it identifies the *type* of transaction, not *which feature* triggered it. There is no column today that records "this debit was for `copilot_turn`". **MET-02 requires a new nullable column** via a new migration (next number: `1225`).
2. There is exactly one debit call site in the entire codebase: `src/lib/copilot/run-turn.ts:141`, which calls `debitCopilot(orgId, costUsd, runId)`. This — not `turn.ts` — is where the actual debit happens; `turn.ts` only does the pre-check (`hasCopilotCredits`) and provisioning (`ensureCopilotProvisioned`). Both files matter for MET-03 but only `run-turn.ts` calls the debit path.
3. The RPC layer (`debit_copilot_credits`, `credit_copilot_credits`, `reset_copilot_credits`) is SECURITY DEFINER, service-role-only, already generic enough (keyed by `org_id` + amount) to sit underneath a generic wrapper — it does not need to change shape, only gain one new optional parameter for the reason tag, threaded through to the ledger insert.
4. The codebase convention for this kind of "generic interface + feature tag" work is a typed string union (see `Feature`/`LimitKey` in `src/lib/billing/catalog.ts`, `GuardResult` pattern in `src/lib/billing/guards.ts`) — not a database enum — because new tags (`workflow_run`, `campaign_dispatch`, etc.) will be added over time by future milestones and a TS union is cheaper to extend than a CHECK constraint requiring a migration each time.

**Primary recommendation:** Add a nullable `reason` text column (no CHECK constraint — future feature tags are unbounded, unlike `kind`) to `copilot_credit_ledger` via a new migration; introduce a new exported function `meterDebit(orgId, { reasonTag, amountUsd, refId })` in `src/lib/billing/credits.ts` (or a new sibling module, see Architecture Patterns) that wraps `debit_copilot_credits` and passes the reason through; refactor `run-turn.ts` to call it instead of `debitCopilot`; keep `debitCopilot` as a thin backward-compatible wrapper (or delete it and update its one call site directly) — either satisfies "no second parallel debit code path" as long as there is only one underlying implementation.

## User Constraints (from CONTEXT.md)

### Locked Decisions

None — this is an infrastructure/refactor phase gathered in auto mode (discuss-phase was skipped). No decisions were locked by the user beyond the phase boundary itself.

### Claude's Discretion

All implementation choices are at Claude's discretion — this is a pure infrastructure/refactor phase (single exported interface, ledger tagging, Copilot call-site refactor, doc comment). No user-facing behavior is defined here; use the ROADMAP phase goal, success criteria, and existing `src/lib/billing/credits.ts` conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. Wiring workflows/campaigns/calls to actually debit through this interface is explicitly deferred to a future milestone (see REQUIREMENTS.md v2 MET-05..08).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MET-01 | Platform has a single reusable credit-debit interface accepting a feature/reason tag (e.g. `copilot_turn`, future `workflow_run`) | Confirmed exactly one existing debit path (`debitCopilot` → `debit_copilot_credits` RPC) to consolidate into; recommend a typed reason-tag union following the `Feature`/`LimitKey` pattern in `catalog.ts` |
| MET-02 | Credit ledger entries record which feature/reason triggered each debit | Confirmed no existing column serves this purpose (`kind` is a constrained enum of transaction types, not feature tags); new nullable `reason` column required via new migration `1225_*.sql` |
| MET-03 | Existing Copilot debit path refactored to call through the new generic interface with no behavior change | Confirmed the single call site is `src/lib/copilot/run-turn.ts:141`; exact current call shape and fail-open semantics documented below for the refactor to preserve byte-for-byte |
| MET-04 | Documentation/code comment describes how a new feature should hook into the metering interface | `credits.ts` already has a strong header-comment convention (see current file header) to extend; recommend JSDoc on the new exported function plus a short "how to add a new metered feature" block |

## Project Constraints (from CLAUDE.md)

- **Migrations:** live in `supabase/migrations/`, numbered sequentially. Never edit old migrations — add new ones. After adding: run `npx supabase db push`, then update `src/types/database.ts` manually or regenerate it.
- **Runtime:** this code runs in the Node.js dashboard/server-action runtime (not Deno, not GitHub Actions) — `run-turn.ts` and `credits.ts` are both server-only (`import 'server-only'`), consistent with existing code.
- **Auth pattern:** N/A directly (no user-facing auth here), but `org_id` passed into wallet functions must always be the caller's resolved active org (`get_current_org_id()`), never client-supplied — this invariant is already documented in `credits.ts`'s header comment and must be preserved.
- **Components/Server actions:** N/A — this phase touches `src/lib/billing/` and `src/lib/copilot/run-turn.ts` only, no UI.
- **Build check:** must run `npm run build` after changes to catch type errors (project-wide rule, not phase-specific).
- **Sensitive paths:** `src/lib/crypto.ts` is called out as sensitive elsewhere in CLAUDE.md but is unrelated to this phase (no encryption format touched here).

## Standard Stack

No new libraries. This phase is a refactor within the existing stack:

| Component | Version/Location | Purpose |
|-----------|------|---------|
| Supabase Postgres RPC (SECURITY DEFINER functions) | `supabase/migrations/1208_copilot_credits.sql` | Atomic balance update + ledger insert |
| `@supabase/supabase-js` service-role client | `src/lib/supabase/admin.ts` (`createServiceRoleClient`) | Trust boundary for wallet writes/reads, bypasses RLS |
| TypeScript facade | `src/lib/billing/credits.ts` | Existing wallet interface to extend/wrap |
| Supabase generated types | `src/types/database.ts` | Row/Insert/Update types for `copilot_credit_ledger`, RPC Args/Returns for `debit_copilot_credits` |

**Installation:** None — no new packages.

**Version verification:** Not applicable — no external package versions involved. This is an internal architecture change against the existing Supabase project.

## Architecture Patterns

### Recommended Module Structure

Two viable placements for the generic interface — pick one, be consistent:

**Option A (recommended): Extend `credits.ts` in place.**
Add the generic function alongside the existing Copilot-specific ones, since the underlying RPCs and table are still Copilot-named (`copilot_credit_balances`, `copilot_credit_ledger`) — renaming the table/RPCs is explicitly out of scope (no requirement calls for it, and doing so would touch Stripe-webhook and admin call sites unnecessarily, expanding blast radius beyond MET-01..04). Keep the file name `credits.ts` since it is still the single wallet facade; only the *exported surface* becomes generic.

```
src/lib/billing/
├── credits.ts       # existing wallet facade — ADD generic meterDebit() here,
│                     # alongside grantCopilot/resetCopilotForPeriod/getCopilotBalance
├── catalog.ts        # existing Feature/LimitKey unions — pattern to copy for reason tags
├── guards.ts          # existing GuardResult-style pattern for return shapes
```

**Option B: New `src/lib/billing/metering.ts` module** that imports and wraps `credits.ts` internals. Adds a file but keeps `credits.ts` untouched. Slightly more indirection for zero real benefit since `credits.ts` is already the trust-boundary module for this exact table. **Not recommended** — adds a layer without reducing coupling (the new module still needs the same service-role client and the same RPC).

Recommendation: **Option A.** Simpler, avoids introducing a redundant module, matches "single reusable interface" (MET-01) more literally — one file, one function, one RPC.

### Pattern 1: Typed reason-tag union (not a DB enum)

**What:** Define a TypeScript string-literal union (or a permissive `string` with a documented convention) for the reason/feature tag, following the existing `Feature`/`LimitKey` pattern in `catalog.ts`.

**When to use:** For the new `meterDebit` function's parameter type.

**Why not a DB CHECK constraint (like `kind`):** `kind` is bounded and stable (`monthly_reset|topup|grant|debit` — transaction *types*, unlikely to grow). Reason tags are the opposite: MET-01's own phase goal lists `copilot_turn` today and `workflow_run` tomorrow, with `campaign_dispatch`/`vapi_call` explicitly deferred (MET-05..07) but expected. A CHECK constraint would require a migration every time a new feature is metered — friction the phase goal explicitly wants to avoid ("without redesign"). A nullable free-text column with a TS union constraining the *known* values (extensible without a migration, just add a string to the union) matches the intent.

**Example (illustrative, adapt to actual code):**
```typescript
// src/lib/billing/credits.ts — new addition, pattern only
/** Feature/reason tag for a metered debit. Extend this union when a new
 *  feature hooks into metering (see MET-04 doc block below). */
export type MeterReason = 'copilot_turn' // | 'workflow_run' | 'campaign_dispatch' | 'vapi_call' (future)

export async function meterDebit(
  orgId: string,
  reason: MeterReason,
  costUsd: number,
  refId?: string | null,
): Promise<{ allowed: boolean; balanceAfter: number }> {
  // same body as current debitCopilot, plus p_reason: reason passed to the RPC
}
```

### Pattern 2: Additive, backward-compatible RPC signature change

**What:** Add `p_reason text DEFAULT NULL` as a new trailing parameter to `debit_copilot_credits`, insert it into the `INSERT INTO copilot_credit_ledger (..., reason) VALUES (..., p_reason)`.

**When to use:** This is the only RPC that needs a signature change for MET-02 (the debit path). `credit_copilot_credits` and `reset_copilot_credits` already have `p_kind`/fixed kinds (`topup`, `grant`, `monthly_reset`) that already self-describe their reason — no change strictly needed there for MET-01..04, since only the *debit* path is being generalized (grants/resets are administrative, not "feature consumption"). Confirm at planning time whether MET-02's "every credit ledger entry" (success criterion 2) is read narrowly (debits only, matching the phase's own framing of "credit-debit interface") or broadly (all ledger kinds) — recommend narrow reading since the phase goal and all four success criteria only discuss the *debit* interface, not grants/resets.

**Why trailing + DEFAULT NULL:** Postgres function parameter defaults let existing call sites (none exist besides the one being refactored, per the grep audit below) continue to compile without modification, and preserves the "SECURITY DEFINER, service_role only" grants already in place — those `REVOKE`/`GRANT` statements in `1208_copilot_credits.sql` apply to a *specific signature*; changing the signature means the new migration must re-issue the `REVOKE ALL ... FROM PUBLIC, anon, authenticated` / `GRANT EXECUTE ... TO service_role` pair for the new signature (Postgres does not carry grants across a `CREATE OR REPLACE FUNCTION` that changes the parameter list — verify this at migration-writing time, since it's a common Postgres gotcha with SECURITY DEFINER functions).

### Anti-Patterns to Avoid

- **Renaming `copilot_*` tables/RPCs to generic names (e.g. `credit_ledger`, `debit_credits`) in this phase.** Out of scope: no requirement calls for it, and it would touch every existing call site (Stripe webhook, admin actions, billing settings page) instead of just the one debit path, turning a scoped refactor into a platform-wide rename. The phase goal says the interface must be reusable *by tag*, not that the storage layer must be renamed today.
- **Building a second debit RPC/table for "generic" metering while leaving `debit_copilot_credits` in place uncalled.** This directly violates success criterion 1 ("there is no second, parallel debit code path"). The generic interface MUST wrap the existing RPC, not duplicate it.
- **Changing fail-open behavior, draw-down order, or the pre-check gate as a side effect of the refactor.** Success criterion 3 requires zero behavior change. The existing `try/catch` fail-open wrapper in `debitCopilot`, the included-then-topup draw-down in the RPC, and the separate pre-check (`hasCopilotCredits`/`ensureCopilotProvisioned` in `turn.ts`) must all be preserved exactly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic balance update + ledger write | A new "generic ledger" table/RPC from scratch | Extend existing `debit_copilot_credits` RPC (row lock via `FOR UPDATE`, atomic UPDATE + INSERT in one statement) | Already handles the hard part (race-safe dual-bucket draw-down under concurrent debits); rebuilding risks losing the `FOR UPDATE` row lock and reintroducing a race condition |
| Feature/reason taxonomy validation | A new lookup table with FK constraints for valid reason tags | A TypeScript string-literal union (extend, no migration) | Matches the phase's own "without redesign" goal — an FK-constrained taxonomy table means every new feature needs a migration, exactly the friction MET-01 is designed to avoid |
| Fail-open error handling | New custom error-swallowing logic per feature | Keep the existing `try/catch` + `console.error` + return-safe-default pattern already in `debitCopilot` | This fail-open contract is deliberate and documented ("a wallet error must never break Copilot") — any new metered feature should get the same guarantee for free from the shared function, not reimplement it |

**Key insight:** Everything genuinely hard here (row-locked atomic balance mutation, append-only audit trail, fail-open safety) is already built and battle-tested in production. The phase is a naming/parameter/typing generalization, not new distributed-systems work.

## Runtime State Inventory

> This section applies because the phase involves refactoring a call site (not a rename/rebrand), but confirming no hidden runtime state is affected is still worth stating explicitly since the phase touches a billing-critical path.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `copilot_credit_ledger` rows (production) have `reason = NULL` after the new column is added (no backfill data exists — there was never a reason tag before). No data migration needed; historical rows simply have no reason recorded, which is correct and expected. | None — new column defaults to NULL, no backfill required |
| Live service config | None — no n8n/external service config references these table/column names outside this codebase | None |
| OS-registered state | None | None |
| Secrets/env vars | None — no env vars reference `copilot_credit_ledger` schema | None |
| Build artifacts | `src/types/database.ts` must be regenerated (or manually updated) after the migration to add the `reason` column to `copilot_credit_ledger`'s Row/Insert/Update types and the new `p_reason` arg to `debit_copilot_credits`'s Args type — per CLAUDE.md's stated workflow (`npx supabase db push` then update types) | Manual type update or `supabase gen types` regeneration required as part of the plan |

## Common Pitfalls

### Pitfall 1: Losing the SECURITY DEFINER grants on `CREATE OR REPLACE FUNCTION` with a changed signature
**What goes wrong:** `debit_copilot_credits(uuid, numeric, uuid)` currently has explicit `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role`. If the new migration does `CREATE OR REPLACE FUNCTION public.debit_copilot_credits(p_org_id uuid, p_amount_usd numeric, p_run_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)`, Postgres treats this as effectively the same function only if the parameter list change is compatible with `OR REPLACE` rules (return type and existing param types/order unchanged, new params appended with defaults — this is allowed). However, the grants from migration 1208 were issued against the exact signature `(uuid, numeric, uuid)`. Confirm whether Postgres carries the grant forward automatically for an appended-default-param case, or whether the new migration must re-run the `REVOKE`/`GRANT` pair against the new signature `(uuid, numeric, uuid, text)`.
**Why it happens:** Supabase/Postgres exposes SECURITY DEFINER functions over PostgREST by default to `anon`/`authenticated` unless explicitly revoked (this exact gotcha is called out in the existing migration's own comment: "REVOKE FROM PUBLIC alone is NOT enough... default privileges grant EXECUTE to anon/authenticated on new public functions").
**How to avoid:** In the new migration, explicitly re-issue both the `REVOKE ALL ON FUNCTION public.debit_copilot_credits(uuid, numeric, uuid, text) FROM PUBLIC, anon, authenticated;` and `GRANT EXECUTE ... TO service_role;` statements against the new 4-arg signature, mirroring the existing migration's own pattern exactly.
**Warning signs:** If skipped, a Supabase advisor security check (`get_advisors` via Supabase MCP) or a manual `\df+` inspection would show the function callable by `authenticated`/`anon` — verify with the Supabase advisors tool after migration.

### Pitfall 2: Confusing the pre-check gate with the debit call — refactoring the wrong site
**What goes wrong:** The phase's own prior-assessment notes (in CONTEXT.md) point to `turn.ts:59` as "the credit pre-check (line ~59) and post-turn debit call." In the actual current code, `turn.ts` only contains the **pre-check** (`hasCopilotCredits` at line 59, `ensureCopilotProvisioned` at line 58). The **debit call** itself is in a *different file*: `src/lib/copilot/run-turn.ts:141` (`await debitCopilot(input.orgId, costUsd, runId)`), inside the `runCopilotTurn` function that `turn.ts` calls.
**Why it happens:** `turn.ts` is the server action entry point; `run-turn.ts` is the actual turn executor it delegates to. Both files reference credits but at different stages of the request lifecycle (gate vs. debit).
**How to avoid:** MET-03's refactor target is `src/lib/copilot/run-turn.ts:141`, not `turn.ts`. `turn.ts`'s pre-check calls (`hasCopilotCredits`, `ensureCopilotProvisioned`) are a *different* concern (gating the next turn) and are explicitly not part of "the debit path" per the phase's success criteria — leave them as-is unless the plan deliberately decides the generic interface should also expose a "check balance" tag-aware function (not required by MET-01..04's wording, which focuses on the debit/write side).
**Warning signs:** If the plan's tasks only mention editing `turn.ts`, it has inherited the stale assumption from the CONTEXT.md prior-assessment note rather than the verified current code.

### Pitfall 3: Scope creep into grant/reset RPCs when only the debit RPC needs a reason tag
**What goes wrong:** Success criterion 2 says "every credit ledger entry written through this interface records which feature/reason" — read broadly, this could tempt adding `p_reason` to `credit_copilot_credits` and `reset_copilot_credits` too.
**Why it happens:** All three RPCs insert into the same `copilot_credit_ledger` table, so it's tempting to add the column symmetrically everywhere.
**How to avoid:** Re-read success criterion 1 and the phase goal: both are scoped to "credit-**debit** interface" — grants and resets are administrative operations already self-describing via `kind` (`topup`/`grant`/`monthly_reset`) and `stripe_ref`/`note`. Only the generic *debit* interface (MET-01) is in scope; adding `reason` only to the debit path (and leaving it NULL/unused for grant/reset rows) satisfies MET-02 ("entries record which feature/reason triggered **each debit**") without expanding the refactor surface into `billing-actions.ts` and the Stripe webhook's reset-on-invoice-paid flow, both out of scope for this phase.
**Warning signs:** Plan tasks that touch `src/app/(admin)/admin/_actions/billing-actions.ts` or `src/app/api/stripe/webhook/route.ts` — neither should need changes for MET-01..04.

## Code Examples

### Current exact call site to refactor (MET-03 target)

`src/lib/copilot/run-turn.ts` (relevant excerpt, current production code):
```typescript
import { debitCopilot } from '@/lib/billing/credits'
// ...
const costUsd = estimateCostUsd(provider.model, inputTokens, outputTokens)
await input.supabase
  .from('copilot_runs')
  .update({
    status: 'succeeded' as const,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: costUsd,
    ended_at: new Date().toISOString(),
  })
  .eq('id', runId)

// Bill the Copilot credit wallet for the cost just incurred (enforcement only).
// Fails open (see debitCopilot) — credit accounting never blocks the response.
if (isBillingEnforced()) {
  await debitCopilot(input.orgId, costUsd, runId)
}
```

This is the ONLY debit call site in the codebase (verified by grepping `debitCopilot|debit_copilot_credits|copilot_credit_ledger` across `src/`). Post-refactor, this becomes (illustrative):
```typescript
import { meterDebit } from '@/lib/billing/credits'
// ...
if (isBillingEnforced()) {
  await meterDebit(input.orgId, 'copilot_turn', costUsd, runId)
}
```

### Current exact RPC and function to wrap (unchanged core logic)

`src/lib/billing/credits.ts` (current production code, lines 91-111):
```typescript
export async function debitCopilot(
  orgId: string,
  costUsd: number,
  runId?: string | null,
): Promise<{ allowed: boolean; balanceAfter: number }> {
  if (!(costUsd > 0)) return { allowed: true, balanceAfter: 0 }
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase.rpc('debit_copilot_credits', {
      p_org_id: orgId,
      p_amount_usd: costUsd,
      p_run_id: runId ?? null,
    })
    if (error) throw error
    const res = (data ?? {}) as { allowed?: boolean; balance_after?: number }
    return { allowed: res.allowed ?? true, balanceAfter: Number(res.balance_after ?? 0) }
  } catch (err) {
    console.error('[billing] debitCopilot failed (failing open):', err)
    return { allowed: true, balanceAfter: 0 }
  }
}
```

### Current RPC definition to extend (MET-02 target)

`supabase/migrations/1208_copilot_credits.sql` (lines 76-118, current production):
```sql
CREATE OR REPLACE FUNCTION public.debit_copilot_credits(
  p_org_id uuid,
  p_amount_usd numeric,
  p_run_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inc numeric;
  v_top numeric;
  v_take_inc numeric;
  v_total numeric;
BEGIN
  IF p_amount_usd IS NULL OR p_amount_usd < 0 THEN
    RAISE EXCEPTION 'debit amount must be >= 0';
  END IF;

  INSERT INTO public.copilot_credit_balances (org_id)
    VALUES (p_org_id)
    ON CONFLICT (org_id) DO NOTHING;

  SELECT included_balance_usd, topup_balance_usd
    INTO v_inc, v_top
    FROM public.copilot_credit_balances
    WHERE org_id = p_org_id
    FOR UPDATE;

  v_take_inc := greatest(0, least(v_inc, p_amount_usd));
  v_inc := v_inc - v_take_inc;
  v_top := v_top - (p_amount_usd - v_take_inc);
  v_total := v_inc + v_top;

  UPDATE public.copilot_credit_balances
    SET included_balance_usd = v_inc,
        topup_balance_usd = v_top,
        updated_at = now()
    WHERE org_id = p_org_id;

  INSERT INTO public.copilot_credit_ledger (org_id, kind, amount_usd, balance_after, copilot_run_id)
    VALUES (p_org_id, 'debit', -p_amount_usd, v_total, p_run_id);

  RETURN jsonb_build_object('allowed', v_total > 0, 'balance_after', v_total);
END $$;
```
MET-02 requires adding a `p_reason text DEFAULT NULL` parameter and threading it into the final `INSERT` as a new `reason` column value.

### All other call sites that touch these tables/functions (must NOT change for this phase)

Verified via grep across `src/` — every consumer of `copilot_credit_*`:

| File | What it does | In scope for MET-01..04? |
|------|--------------|---------------------------|
| `src/lib/copilot/run-turn.ts:141` | Calls `debitCopilot()` — the debit path | **Yes — refactor target** |
| `src/app/(dashboard)/copilot/_actions/turn.ts:58-59` | Pre-check gate (`ensureCopilotProvisioned`, `hasCopilotCredits`) | No — different concern (gating, not debiting); leave unchanged |
| `src/app/(dashboard)/settings/billing/page.tsx:66-67` | Reads `getCopilotBalance`, `getCopilotLedger` for the billing UI | No — read-only, unaffected by adding a nullable column |
| `src/app/(admin)/admin/_actions/billing-actions.ts:122,198` | Calls `grantCopilot` (top-up) and `resetCopilotForPeriod` (period reset) | No — administrative operations, out of scope per Pitfall 3 |
| `src/app/(admin)/admin/_actions/get-org-detail.ts:53` | Direct `.from('copilot_credit_balances').select(...)` read (bypasses the facade) | No — read-only, unaffected |
| `src/components/admin/org-billing-card.tsx:14,131` | Calls `grantCopilotCredits` (admin action wrapper around `grantCopilot`) | No — administrative, out of scope |
| `src/app/api/stripe/webhook/route.ts` | Confirmed present in grep results (need to check exact usage) but conceptually the invoice.paid handler that likely calls `resetCopilotForPeriod`/`ensureCopilotProvisioned` | No — out of scope per Pitfall 3, but worth a final `grep debitCopilot` sanity check when planning to rule out a second debit call hiding in the webhook |

**Key finding for MET-01 success criterion 1** ("there is no second, parallel debit code path"): confirmed by exhaustive grep — `debitCopilot` (the debit-specific function) is imported and called in exactly one place (`run-turn.ts`). There is no existing second debit path to worry about; the refactor is a clean single-call-site change.

## State of the Art

Not applicable in the traditional sense (no external ecosystem shift) — this is an internal architecture decision. The relevant "current vs. proposed" comparison is:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Copilot-specific `debitCopilot(orgId, costUsd, runId)` | Generic `meterDebit(orgId, reason, costUsd, refId)` accepting any feature tag | This phase (114) | Enables future features (workflows, campaigns, calls — MET-05..08, deferred) to debit through the same interface without adding new parallel debit functions per feature |
| Ledger `kind` enum only (`debit` undifferentiated by feature) | Ledger `reason` column tags which feature caused each `debit` row | This phase (114) | Enables per-feature cost attribution/auditing in the ledger, a prerequisite for future usage analytics across features |

**Deprecated/outdated:** None — `debitCopilot` itself isn't deprecated by definition, but per MET-03 its call site should be migrated so there's a single interface; whether the old function name is kept as a thin wrapper or removed entirely is a planning-time decision (either satisfies "no second parallel debit code path" as long as there's one underlying implementation).

## Open Questions

1. **Should `debitCopilot` be deleted or kept as a deprecated wrapper?**
   - What we know: Only one call site exists (`run-turn.ts`), so deleting and updating that one import is low-risk.
   - What's unclear: Whether keeping a `debitCopilot` wrapper (calling `meterDebit(orgId, 'copilot_turn', ...)`) adds unnecessary surface area vs. a clean removal.
   - Recommendation: Delete `debitCopilot` and update the one call site directly — simpler, matches "single reusable interface" more literally, and there's no external/other consumer to break (confirmed by grep).

2. **Exact naming: `meterDebit` vs. `debitCredits` vs. `debitMeteredCredits`?**
   - What we know: The project's `catalog.ts`/`guards.ts` use short, direct names (`requireFeature`, `requireWithinLimit`, `hasFeature`). `credits.ts` uses `debitCopilot`, `grantCopilot`, `getCopilotBalance` (subject-first naming, `<Verb><Copilot>` pattern).
   - What's unclear: Whether the new generic function should keep the `Copilot`-adjacent naming style (e.g., `debitCredits`) now that it's no longer Copilot-specific, or introduce a new "meter" vocabulary (`meterDebit`) that better signals genericity for future readers wiring up `workflow_run`.
   - Recommendation: Planner's discretion (explicitly a Claude's Discretion area per CONTEXT.md) — either is defensible; `debitCredits(orgId, reason, amountUsd, refId)` slightly better matches existing file naming conventions, `meterDebit` slightly better signals the new generic intent. Pick one and use it consistently in the doc comment (MET-04).

3. **Does `refId`/`runId` stay Copilot-run-specific, or become a generic string ref?**
   - What we know: The RPC parameter is `p_run_id uuid` with an FK to `copilot_runs.id` (`ON DELETE SET NULL`). Future features (`workflow_run`) will have their own run/execution IDs that are NOT rows in `copilot_runs`.
   - What's unclear: Whether MET-01 requires the ref parameter to become feature-agnostic (e.g., drop the FK constraint, store as free text) in this phase, or whether that generalization is deferred to whichever future phase actually wires up `workflow_run` (MET-05).
   - Recommendation: Given the phase's explicit "zero behavior change" requirement for Copilot (MET-03) and that wiring other features is explicitly deferred (MET-05..08 in v2 requirements), the safest interpretation is: keep `p_run_id`/`copilot_run_id` FK exactly as-is for now (it stays nullable and Copilot-specific), and let a future phase decide whether to generalize or add a parallel free-text ref column when a second feature actually needs to pass a non-Copilot-run ID. Document this limitation in the MET-04 doc comment so the next implementer isn't surprised.

## Validation Architecture

### Test Framework

No existing automated test suite covers `src/lib/billing/credits.ts` or the `copilot_credit_ledger`/`copilot_credit_balances` RPCs — this is confirmed as a known gap: BTC-03 ("Automated tests cover the credit debit/credit RPCs") is explicitly a *separate, later* phase (116 — Billing Test Coverage), sequenced deliberately *after* this phase per STATE.md's decision log ("Billing Test Coverage (116) sequenced after Metering Architecture (114) so RPC tests assert against the post-refactor call shape, not a pre-refactor one").

| Property | Value |
|----------|-------|
| Framework | Vitest (per CLAUDE.md file structure: `tests/ — Vitest tests`) |
| Config file | Not inspected this pass — check `vitest.config.*` at repo root during planning |
| Quick run command | Not yet established for billing/credits — likely `npx vitest run tests/<path>` once BTC-03 lands |
| Full suite command | Not yet established — check `package.json` scripts during planning |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MET-01 | `meterDebit`/generic interface accepts a reason tag and performs the same dual-bucket debit | unit (deferred) | N/A this phase | ❌ Deferred to Phase 116 (BTC-03) per STATE.md sequencing decision |
| MET-02 | Ledger row written through the interface has a non-null `reason` matching the tag passed | unit (deferred) | N/A this phase | ❌ Deferred to Phase 116 (BTC-03) |
| MET-03 | Copilot's debit behavior (draw-down order, insufficient-balance, ledger writes) unchanged pre/post refactor | manual verification + existing production usage | Manual: exercise a real Copilot turn in dev/staging with `BILLING_ENFORCEMENT_ENABLED` on, compare ledger row shape before/after | ❌ No automated regression test exists yet; this phase should verify manually since BTC-03's automated coverage doesn't land until Phase 116 |
| MET-04 | Doc comment present and accurate | manual review | N/A — code review checklist item | N/A |

**Important sequencing note:** Since BTC-03 (automated RPC test coverage) is deliberately deferred to Phase 116 to run *against* this phase's refactored shape, Phase 114 itself has no automated test safety net for its own "zero behavior change" claim (MET-03). The plan should include a **manual verification step** (e.g., a documented before/after comparison of ledger rows for a real or scripted Copilot turn) as a substitute gate, since writing throwaway tests now that get rewritten in Phase 116 would be double work — but *some* verification evidence should exist before declaring MET-03 done.

### Sampling Rate
- **Per task commit:** `npm run build` (project-wide type-check gate per CLAUDE.md) — critical here since RPC Args/Returns types and ledger Row types are changing.
- **Per wave merge:** Manual smoke test of a Copilot turn end-to-end (send message → verify ledger row with `reason = 'copilot_turn'` appears with correct `amount_usd`/`balance_after`) since no automated suite exists yet for this table.
- **Phase gate:** `npm run build` green + manual ledger inspection confirming no regression in draw-down order or fail-open behavior, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] No test file exists for `src/lib/billing/credits.ts` — deliberately deferred to Phase 116 (BTC-03), not a gap to fill in this phase.
- [ ] No test file exists for `debit_copilot_credits` RPC — same deferral.
- Framework install: none needed — Vitest is already a project dependency per CLAUDE.md.

*(Gaps intentionally left for Phase 116 per the documented roadmap sequencing — not an oversight.)*

## Environment Availability

Skipped — this phase has no external dependencies beyond the existing Supabase project (already connected and in production use) and Node.js runtime (already the project's standard runtime). No new CLIs, services, or tools are introduced.

## Sources

### Primary (HIGH confidence — direct file reads, this session)
- `C:\Users\Vanildo\Dev\xphere\src\lib\billing\credits.ts` — full current file content (178 lines), all five exported functions
- `C:\Users\Vanildo\Dev\xphere\src\app\(dashboard)\copilot\_actions\turn.ts` — full current file content (169 lines)
- `C:\Users\Vanildo\Dev\xphere\src\lib\copilot\run-turn.ts` — relevant excerpt (lines 100-160) containing the actual debit call site
- `C:\Users\Vanildo\Dev\xphere\supabase\migrations\1208_copilot_credits.sql` — full migration (197 lines): table DDL, RLS policies, all three RPCs, grants
- `C:\Users\Vanildo\Dev\xphere\src\types\database.ts` — generated types for `copilot_credit_balances`, `copilot_credit_ledger` Row/Insert/Update, and RPC Args/Returns for all three functions
- `C:\Users\Vanildo\Dev\xphere\src\lib\supabase\admin.ts` — `createServiceRoleClient` implementation confirming the trust-boundary pattern
- `C:\Users\Vanildo\Dev\xphere\src\lib\billing\guards.ts` — sibling module confirming naming/typing conventions (`GuardResult`, `Feature`/`LimitKey` pattern reference)
- Exhaustive grep across `src/` for `debitCopilot|debit_copilot_credits|copilot_credit_ledger|credit_copilot_credits|reset_copilot_credits|copilot_credit_balances` — confirms exactly 8 files touch this subsystem, all catalogued in the Code Examples table above
- `C:\Users\Vanildo\Dev\xphere\.planning\workstreams\billing-robustness\phases\114-metering-architecture\114-CONTEXT.md`
- `C:\Users\Vanildo\Dev\xphere\.planning\workstreams\billing-robustness\REQUIREMENTS.md`
- `C:\Users\Vanildo\Dev\xphere\.planning\workstreams\billing-robustness\STATE.md`
- `C:\Users\Vanildo\Dev\xphere\CLAUDE.md`
- `supabase/migrations/` directory listing — confirms latest migration number is `1224_booking_status_showed.sql`, so the new migration for this phase should be numbered `1225_*.sql`

### Secondary (MEDIUM confidence)
None used — no external/WebSearch sources were needed for this internal-refactor phase.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, entirely existing in-repo code verified by direct reads
- Architecture: HIGH — recommendation grounded in direct comparison against existing sibling modules (`catalog.ts`, `guards.ts`) and the exact current RPC/table shape
- Pitfalls: HIGH — Pitfall 1 (grants) is grounded in the migration's own explicit comment about this exact gotcha; Pitfall 2 (wrong call site) is grounded in direct verification that CONTEXT.md's prior-assessment note was imprecise about which file contains the debit call; Pitfall 3 (scope creep) is grounded in a close reading of the phase goal's exact wording

**Research date:** 2026-07-01
**Valid until:** 30 days (stable internal codebase, no fast-moving external dependency; re-verify call sites if other billing-robustness phases (115-117) land first and touch this code before 114 is planned/executed)

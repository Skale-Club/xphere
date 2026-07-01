# Phase 117: Billing Observability - Research

**Researched:** 2026-07-01
**Domain:** Operational observability wiring (billing failure -> event_logs -> admin viewer)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Reuse Existing Observability Infrastructure (key architectural decision)**
The platform already has a generic operational log table (`event_logs`, migration 1068) with `source`/`severity`/`status`/`error_message` columns, and an existing admin viewer at `/admin/logs` (`getPlatformLogs()` in `src/app/(admin)/admin/logs/_actions/get-platform-logs.ts`) that already filters by source, severity, status, tenant, period, and free-text search. This phase does NOT build a new billing-specific admin panel — it wires the two billing failure points to write rows into the existing `event_logs` table, tagged with a distinguishing `source` value. BOB-03 ("admin can see recent billing failures without a manual DB query") is satisfied by the existing `/admin/logs` page once these writes land — filtering by `source = 'stripe-webhook'` (or the chosen source tag for webhook errors) or `source = 'billing-credits'` (or chosen tag for debit failures) surfaces them with zero new UI.

This was an explicit user choice (reuse vs. build dedicated panel) — reuse was chosen to avoid duplicating an already-solved generic problem.

### Claude's Discretion
- Exact `source` tag values for the two failure points (e.g. `'stripe-webhook'` and `'billing-credits'` vs alternatives) — pick clear, distinguishing values consistent with existing `source` conventions already in the table (`action-engine`, `vapi-webhook`, `meta-webhook`, `cron`)
- Exact `event_type` values, `severity`/`status` mapping, and what goes in `payload` vs `error_message`/`error_stack`
- Whether webhook failure logging happens for ALL processing exceptions or only specific ones — should cover any exception during event processing (BOB-01's wording: "errors during processing")
- Whether the credit-debit failure log write happens inside `meterDebit`'s existing catch block or via a wrapper

### Deferred Ideas (OUT OF SCOPE)
A dedicated billing-specific admin panel (with billing-specific summary cards, etc.) was considered and explicitly deferred in favor of reusing the generic `/admin/logs` viewer.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BOB-01 | A failed/errored Stripe webhook event is recorded in a queryable/alertable way instead of being silently swallowed | Exact catch block located (`src/app/api/stripe/webhook/route.ts` lines 90-95); existing `log()` helper identified as the write mechanism; org_id availability constraint documented below |
| BOB-02 | A failed credit-debit RPC call is recorded distinctly from the existing fail-open behavior instead of disappearing silently | Exact catch block located (`src/lib/billing/credits.ts` lines 209-212, `meterDebit()`); orgId is the function's first parameter, always in scope |
| BOB-03 | Platform admin can see recent billing failures (webhook + debit) without querying the database directly | Already satisfied by existing `/admin/logs` + `getPlatformLogs()` once both call sites write rows with a distinct `source` — confirmed no UI changes needed; `sources` dropdown auto-populates from distinct `event_logs.source` values (see `get-platform-logs.ts` line 178) |
</phase_requirements>

## Summary

The platform already has a complete, working helper for exactly this problem: `log()` exported from `src/lib/logger.ts`. It is a fire-and-forget async function that inserts a row into `event_logs` using its own internally-managed service-role Supabase client (a raw `@supabase/supabase-js` `createClient`, independent of `createServiceRoleClient()` from `@/lib/supabase/admin`). It never throws — all errors (missing env vars, insert failures, unexpected exceptions) are caught internally and only logged to `console.error`. Two existing call sites (`src/lib/action-engine/execute-action.ts`, `src/app/api/vapi/calls/route.ts`) establish the exact convention: call `void log({...})` (not awaited) at the point of failure, inside the existing catch block, with `source` set to a subsystem tag, `severity: 'error'`, `status: 'failed'`, and `error_message` set to the caught error's message.

This phase requires zero new database schema, zero new admin UI, and zero new helper functions. It is a two-call-site wiring task: add one `void log({...})` call inside the Stripe webhook route's existing catch block (`src/app/api/stripe/webhook/route.ts`), and one inside `meterDebit()`'s existing catch block (`src/lib/billing/credits.ts`). Both catch blocks already exist and already do the "swallow and console.error" pattern described in CONTEXT.md — the change is additive (insert one `log()` call before/alongside the existing `console.error`), not a restructure.

**Primary recommendation:** Reuse `log()` from `@/lib/logger` verbatim at both failure points — do not write a raw `.from('event_logs').insert(...)` and do not build a wrapper. Use `source: 'stripe-webhook'` for the webhook route and `source: 'billing-credits'` for `meterDebit`. Neither existing Phase 116 test file mocks `@/lib/logger`, so adding the call will not break `tests/billing-webhook.test.ts` or `tests/billing-credit-rpcs.test.ts` as-is (their existing assertions are unaffected) — but this phase should ADD `vi.mock('@/lib/logger', ...)` plus new assertions to both files to actually verify BOB-01/BOB-02, rather than relying on an unmocked real network call in CI.

## Standard Stack

Not applicable in the traditional sense — no new libraries. The "stack" here is 100% existing first-party code:

| Component | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| `log()` | `src/lib/logger.ts` | Fire-and-forget structured insert into `event_logs` | Already the established helper for exactly this use case; used by `action-engine` and `vapi-webhook` subsystems |
| `event_logs` table | `supabase/migrations/1068_event_logs.sql` | Durable, queryable, RLS-protected operational log | Already exists, already has an admin viewer, already supports `source` filtering |
| `getPlatformLogs()` | `src/app/(admin)/admin/logs/_actions/get-platform-logs.ts` | Reads/filters `event_logs` for the admin UI | Already supports `source`, `severity`, `status`, `tenant`, `period`, free-text search — zero changes needed |
| `/admin/logs` page | `src/app/(admin)/admin/logs/page.tsx` | Renders `getPlatformLogs()` output | Already renders whatever rows exist; new `source` values appear automatically in the filter dropdown |

**No installation needed.** No new packages.

## Architecture Patterns

### Pattern: Fire-and-forget `log()` call inside an existing catch block

**What:** At the exact point an error is already being caught and swallowed (webhook processing failure, debit RPC failure), add a `void log({...})` call using the fields already available in that scope. Do not await it in a way that could throw — `log()` already guarantees it never throws, so `void` (not `await`) is the correct call style, matching both existing precedents.

**When to use:** Any subsystem that already has a "catch and continue/fail-open" pattern and needs the failure to become visible without changing the caller's control flow.

**Example — the established convention (from `src/lib/action-engine/execute-action.ts`, lines 128-140):**
```typescript
// Source: src/lib/action-engine/execute-action.ts (existing code, Phase pre-114)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  void log({
    event_type: 'action.failed',
    source: 'action-engine',
    severity: 'error',
    status: 'failed',
    org_id: ctx?.organizationId,
    actor_type: 'system',
    duration_ms: Date.now() - startMs,
    error_message: message,
    payload: { action_type: actionType },
  })
  throw err // (execute-action.ts re-throws; the webhook/credits call sites do NOT — see below)
}
```

**Example — webhook-style precedent, org_id optional (from `src/app/api/vapi/calls/route.ts`, lines 116-131):**
```typescript
// Source: src/app/api/vapi/calls/route.ts (existing code)
if (error.code !== '23505') {
  obs.error('vapi_calls_insert_error', { error: error.message })
  void log({
    event_type: 'call.ingested',
    source: 'vapi-webhook',
    severity: 'error',
    status: 'failed',
    org_id: organizationId,
    actor_type: 'webhook',
    actor_id: vapiCallId,
    error_message: error.message,
    duration_ms: Date.now() - webhookStart,
    payload: { vapi_call_id: vapiCallId, ended_reason: endedReason },
  })
}
```

### Recommended insertion points (exact, verified by reading full files)

**1. `src/app/api/stripe/webhook/route.ts` — BOB-01 target**

Current code (lines 78-95):
```typescript
  // Phase 2 — process. Unsupported events fall through to the no-op tail.
  try {
    if (SUPPORTED_EVENTS.has(event.type)) {
      await handleEvent(event)
    }

    await supabase
      .from('billing_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id)

    return Response.json({ received: true })
  } catch (err) {
    // Leave processed_at null so Stripe's retry re-runs the (idempotent) handler.
    console.error(`[stripe/webhook] Failed handling ${event.type} (${event.id}):`, err)
    captureApiError(err)
    return new Response('Processing error', { status: 500 })
  }
```

Add a `void log({...})` call inside the `catch (err)` block (line 90-95), alongside the existing `console.error` and `captureApiError(err)` calls. **Import** `log` from `@/lib/logger` at the top of the file (new import line, alongside the existing `import { createServiceRoleClient } from '@/lib/supabase/admin'`).

**org_id availability at this catch site — IMPORTANT CONSTRAINT:** `org_id` is NOT a local variable in scope at this outer catch block. It is resolved INSIDE `handleEvent()` on a per-branch basis (e.g. `session.metadata.org_id` in the `checkout.session.completed` branch, or via `resolveOrgIdByCustomer(customerId)` inside the private `refreshCopilotAllowance()` helper for invoice events) — none of those variables propagate up to the outer catch. The plan must either:
  (a) log with `org_id: undefined` (platform-level event, acceptable per the table's nullable `org_id` design — `event_logs.org_id` is explicitly documented as nullable "for platform-level events"), relying on `event.id` / `event.type` in `payload` for admin triage, or
  (b) thread org_id resolution earlier (more invasive — NOT recommended, changes existing control flow beyond what BOB-01 requires).
  **Recommendation: (a).** The event itself (`event.id`, `event.type`) is fully available and sufficient for an admin to triage in Stripe's dashboard; do not expand `handleEvent`'s signature or add speculative org resolution just for logging purposes.

Recommended log call:
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[stripe/webhook] Failed handling ${event.type} (${event.id}):`, err)
  captureApiError(err)
  void log({
    event_type: 'webhook.failed',
    source: 'stripe-webhook',
    severity: 'error',
    status: 'failed',
    actor_type: 'webhook',
    actor_id: event.id,
    error_message: message,
    payload: { stripe_event_type: event.type, stripe_event_id: event.id },
  })
  return new Response('Processing error', { status: 500 })
}
```

Per CONTEXT.md's discretion note ("cover any exception during event processing"), this single catch already wraps `handleEvent(event)` for ALL `SUPPORTED_EVENTS` branches plus the `billing_events` update — one log call at this one site satisfies BOB-01 for every event type without per-branch duplication.

**2. `src/lib/billing/credits.ts` `meterDebit()` — BOB-02 target**

Current code (lines 191-213):
```typescript
export async function meterDebit(
  orgId: string,
  reason: MeterReason,
  costUsd: number,
  refId?: string | null,
): Promise<{ allowed: boolean; balanceAfter: number }> {
  if (!(costUsd > 0)) return { allowed: true, balanceAfter: 0 }
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase.rpc('debit_copilot_credits', {
      p_org_id: orgId,
      p_amount_usd: costUsd,
      p_run_id: refId ?? null,
      p_reason: reason,
    })
    if (error) throw error
    const res = (data ?? {}) as { allowed?: boolean; balance_after?: number }
    return { allowed: res.allowed ?? true, balanceAfter: Number(res.balance_after ?? 0) }
  } catch (err) {
    console.error('[billing] meterDebit failed (failing open):', err)
    return { allowed: true, balanceAfter: 0 }
  }
}
```

`orgId` is the function's FIRST PARAMETER — always in scope at the catch block, no resolution needed. `reason` (the `MeterReason` tag, e.g. `'copilot_turn'`) and `refId` are also in scope and useful payload context.

Recommended log call:
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[billing] meterDebit failed (failing open):', err)
  void log({
    event_type: 'credit_debit.failed',
    source: 'billing-credits',
    severity: 'error',
    status: 'failed',
    org_id: orgId,
    actor_type: 'system',
    error_message: message,
    payload: { reason, cost_usd: costUsd, ref_id: refId ?? null },
  })
  return { allowed: true, balanceAfter: 0 }
}
```

**Import** `log` from `@/lib/logger` at the top of `credits.ts` (new import line, alongside the existing `import { createServiceRoleClient } from '@/lib/supabase/admin'`). Note `credits.ts` has a top-level `import 'server-only'` (line 8) — `@/lib/logger` has no such restriction (it's a plain server-side module with no `'server-only'` guard), so this import is safe and will not trigger the same server/client bundling issue documented in STATE.md for Phase 115's `credits-visibility.ts` extraction (that issue was about a CLIENT component importing `credits.ts`; `meterDebit` itself is already server-only and unaffected).

### Anti-Patterns to Avoid
- **Do not write a raw `.from('event_logs').insert(...)` at either call site.** The existing `log()` helper already handles service-role client instantiation, error swallowing, and default field population (`severity`, `status`, `payload` defaults). Replicating that logic inline would diverge from the one established convention and duplicate ~30 lines of defensive code for no benefit.
- **Do not `await` the `log()` call in a way that could propagate its failure.** `log()` already never throws (verified by reading its full source — every code path is wrapped in try/catch), so `void log({...})` (fire-and-forget, matching both existing call sites) is correct; do not add a redundant try/catch around it.
- **Do not block or delay the webhook's 500 response or `meterDebit`'s fail-open return** waiting on the log write. Both existing precedents use `void`, not `await`, for exactly this reason — the whole point of BOB-01/BOB-02 is to observe a failure without changing user-facing behavior (webhook still returns 500 for Stripe's retry; `meterDebit` still fails open).
- **Do not introduce a new `event_logs`-writing wrapper/abstraction** ("Claude's Discretion" in CONTEXT.md floats a wrapper as an option) — the direct `log()` call matches the two existing precedents exactly and needs no new abstraction layer for two call sites.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Writing structured event rows to `event_logs` | A new `logBillingFailure()` wrapper, or a raw `.insert()` call | `log()` from `src/lib/logger.ts` | Already handles client instantiation, default fields, and error swallowing; used by 2 other subsystems already |
| Surfacing failures in an admin UI | A new admin panel/route/page for billing failures | Existing `/admin/logs` page + `getPlatformLogs()` | Already supports filtering by `source`; the `sources` dropdown (line 178 of `get-platform-logs.ts`) auto-derives from distinct values in the last `period` window — no code change needed there |

**Key insight:** This phase's entire technical surface is "call an existing function from two new places." Resist any urge to add schema, UI, or abstraction — CONTEXT.md's locked decision explicitly rules this out.

## Established `source` Tag Convention

Existing distinct `source` values found via grep across `src/` (non-billing, for-reference):
`action-engine`, `vapi-webhook`, `workflow`, `zernio_echo`, `ghl_sync`, `whatsapp`, `cloud_api`, `telegram`, `mobile_app_echo`.

No existing `source` value starts with `stripe` or `billing` — confirmed via targeted grep (`source:\s*'(stripe|billing)`, zero matches in `src/`). This gives full freedom to pick non-colliding tags.

**Recommended tags (matches CONTEXT.md's suggested values exactly):**
- `'stripe-webhook'` — for the webhook route's catch block (BOB-01). Chosen over `'billing-webhook'` for consistency with the existing `-webhook` suffix convention (`vapi-webhook`, presumably future `meta-webhook`) and to disambiguate from the `billing-credits` tag below.
- `'billing-credits'` — for `meterDebit()`'s catch block (BOB-02). Distinguishes the metering/wallet subsystem from the webhook ingestion subsystem, so an admin filtering by `source` can tell "Stripe told us something went wrong" apart from "our own debit RPC failed."

**Recommended `event_type` values** (dot-namespaced, matching the existing `action.executed`/`action.failed`/`webhook.received`/`call.ingested` convention):
- `'webhook.failed'` for the Stripe webhook catch block.
- `'credit_debit.failed'` for the `meterDebit` catch block.

**`severity`/`status` mapping:** both failures are genuine errors with user-invisible consequences (Stripe retry pending / balance not decremented) — use `severity: 'error'`, `status: 'failed'` for both, consistent with every other error-path `log()` call site found in the codebase.

## Common Pitfalls

### Pitfall 1: Assuming org_id is available at the webhook's outer catch block
**What goes wrong:** A plan/implementation might assume `orgId` is a simple local variable at the webhook route's catch site (like it is in `meterDebit`), and either write broken code referencing an undefined variable, or unnecessarily restructure `handleEvent()`'s signature to thread it through.
**Why it happens:** `orgId` IS resolved inside `handleEvent()`'s branches, just not returned or exposed to the caller — easy to miss without reading the full function.
**How to avoid:** Log with `org_id` omitted (undefined) at the webhook catch site; the table explicitly supports platform-level (`org_id IS NULL`) events, and `event.id`/`event.type` in `payload` is sufficient context for admin triage of a webhook processing failure.
**Warning signs:** TypeScript error referencing an undefined `orgId`/`organizationId` variable in the outer catch scope.

### Pitfall 2: Unmocked `log()` calls silently hitting the real database in tests
**What goes wrong:** Neither `tests/billing-webhook.test.ts` nor `tests/billing-credit-rpcs.test.ts` currently mocks `@/lib/logger`. Adding a `void log({...})` call to production code without also mocking `@/lib/logger` in these test files means the "processing failure" test and the "fails OPEN" tests will trigger a REAL insert against the real Supabase project (via `.env.local`'s real `SUPABASE_SERVICE_ROLE_KEY`, loaded by `tests/setup/load-env.ts`) every CI run. This won't fail the test (the call is fire-and-forget and swallows its own errors) but is an undesirable side effect (test pollution of the `event_logs` table, wasted network calls, and the new behavior — the entire point of BOB-01/BOB-02 — has zero test coverage).
**Why it happens:** `log()`'s internal client is a separate `@supabase/supabase-js` `createClient()` call, not `createServiceRoleClient()` from `@/lib/supabase/admin` — so mocking `@/lib/supabase/admin` (which both existing test files already do) does NOT intercept `log()`'s writes.
**How to avoid:** Add `vi.mock('@/lib/logger', () => ({ log: vi.fn() }))` to both `tests/billing-webhook.test.ts` and a new/extended test in `tests/billing-credit-rpcs.test.ts` (or a new dedicated test file — see Validation Architecture below), then assert `log` was called with the expected `source`/`event_type`/`org_id`/`error_message` shape in the existing "processing failure" / "fails OPEN" test cases.
**Warning signs:** CI logs showing outbound Supabase calls from test runs that weren't previously present; `event_logs` rows appearing in the real database tagged with test fixture IDs like `evt_processing_fail_1` or `org-1`.

### Pitfall 3: Awaiting `log()` and wrapping it in a new try/catch
**What goes wrong:** Adding unnecessary defensive code around `log()` (e.g., `try { await log({...}) } catch {}`) that duplicates the safety `log()` already guarantees, adds latency to the webhook's error response, and diverges from the established `void log({...})` fire-and-forget convention used at both existing call sites.
**Why it happens:** Reasonable instinct to be defensive around a new DB write in a failure path, but `log()`'s source (read in full above) already guarantees it never throws.
**How to avoid:** Match the exact `void log({...})` call style from `execute-action.ts` / `vapi/calls/route.ts` — no `await`, no wrapping try/catch.
**Warning signs:** Added latency in webhook 500 responses; new try/catch blocks around a `log()` call in review.

## Code Examples

### The `log()` helper's full contract (verified by reading source in full)
```typescript
// Source: src/lib/logger.ts (existing, unmodified)
export interface LogEntry {
  event_type: string
  source: string
  severity?: LogSeverity   // 'debug'|'info'|'warn'|'error'|'fatal', defaults 'info'
  status?: LogStatus       // 'ok'|'failed'|'retried'|'skipped', defaults 'ok'
  org_id?: string          // omit for platform-level events
  correlation_id?: string
  actor_type?: string      // 'system'|'user'|'agent'|'webhook'
  actor_id?: string
  payload?: Record<string, unknown>
  error_message?: string
  duration_ms?: number
}
export async function log(entry: LogEntry): Promise<void> // never throws
```
Note: `error_stack` exists as a column on `event_logs` (migration 1068) but is NOT exposed on `LogEntry` / not written by `log()` today — only `error_message` is settable via this helper. This is an existing gap in `log()` itself, out of scope to fix in this phase (do not add `error_stack` support unless it becomes necessary — stick to the established interface).

## Runtime State Inventory

Not applicable — this phase is a pure additive code change (two new `log()` calls at existing catch blocks), not a rename/refactor/migration. No stored data, service config, OS-registered state, secrets, or build artifacts are affected.

## Open Questions

1. **Should `meterDebit`'s log call include `refId` in the payload even when it's a Copilot-run-specific ID?**
   - What we know: `refId` is documented in `credits.ts` as "today this column is still Copilot-run-specific" (a FK to `copilot_runs`), and is optional.
   - What's unclear: Whether including it in the `event_logs.payload` JSON (as opposed to a real column) creates any ambiguity for future non-Copilot metering features.
   - Recommendation: Include it as `ref_id` in `payload` regardless — `payload` is a free-form JSONB field precisely for this kind of context, and it costs nothing to include; if `refId` is null, it logs as `null`.

2. **Does BOB-01's "errors during processing" cover the signature-verification failure path (400) or only the try/catch around `handleEvent`?**
   - What we know: CONTEXT.md's phrasing and the phase description both specifically reference "a Stripe webhook event that errors DURING PROCESSING" — the 400 signature-mismatch path is a rejection of an untrusted/malformed request, not a processing error of a legitimate event, and Phase 116's tests already treat these as separate scenarios (signature verification vs. processing failure).
   - What's unclear: Whether an admin would also want visibility into repeated signature failures (could indicate a misconfigured webhook secret or an attack).
   - Recommendation: Scope BOB-01 strictly to the existing `catch (err)` block around `handleEvent`/`billing_events` update (line 90-95), matching CONTEXT.md's explicit code_context reference to that exact catch block. Do not add logging to the signature-verification branch — that's a distinct concern (arguably security monitoring, not billing observability) and expanding scope there was not requested.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (see `vitest.config.ts`) |
| Config file | `C:\Users\Vanildo\Dev\xphere\vitest.config.ts` |
| Quick run command | `npx vitest run tests/billing-webhook.test.ts tests/billing-credit-rpcs.test.ts` |
| Full suite command | `npm run build` (includes type check) then `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BOB-01 | Webhook processing failure writes an `event_logs`-shaped call via `log()` with `source: 'stripe-webhook'`, `severity: 'error'`, `status: 'failed'`, correct `error_message` | unit | `npx vitest run tests/billing-webhook.test.ts -t "processing failure"` | Extend existing file — add `vi.mock('@/lib/logger', ...)` + assertion in the existing `'returns 500 "Processing error" and does NOT write processed_at when handleEvent throws'` test (line 465 of `tests/billing-webhook.test.ts`) |
| BOB-02 | `meterDebit` failure (both the "RPC returns error" and "RPC call rejects" cases) writes a `log()` call with `source: 'billing-credits'`, `org_id` = the orgId param, `severity: 'error'`, `status: 'failed'` | unit | `npx vitest run tests/billing-credit-rpcs.test.ts -t "fails OPEN"` | Extend existing file — add `vi.mock('@/lib/logger', ...)` + assertions in the two existing `'fails OPEN when...'` tests (lines 62-78 of `tests/billing-credit-rpcs.test.ts`) |
| BOB-03 | Admin can see both failure types via `/admin/logs` filtered by `source` | manual / already covered | N/A — no new code path; existing `getPlatformLogs()` behavior is unchanged | ✅ — `getPlatformLogs()` has no test file found in `tests/`; BOB-03 is satisfied automatically once BOB-01/BOB-02 write real rows. No new automated test needed; a manual checkpoint (query `/admin/logs?source=stripe-webhook` and `?source=billing-credits` after triggering a real or staged failure) is the appropriate verification, consistent with how BOB-03 is framed as a UI-reuse outcome rather than new logic |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/billing-webhook.test.ts tests/billing-credit-rpcs.test.ts`
- **Per wave merge:** `npm run build && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/billing-webhook.test.ts` — add `vi.mock('@/lib/logger', () => ({ log: vi.fn() }))` near the top-level mocks (alongside the existing `vi.mock('@/lib/supabase/admin', ...)` etc.), then import `log` and add an assertion in the existing "processing failure" describe block — covers BOB-01
- [ ] `tests/billing-credit-rpcs.test.ts` — add `vi.mock('@/lib/logger', () => ({ log: vi.fn() }))`, then import `log` and add assertions in the two existing "fails OPEN" tests — covers BOB-02
- [ ] No new test files needed; no new framework/config needed — both target files already exist with the exact right shape of test (error-path assertions) to extend

*(Both gaps are "extend existing file," not "create new file" — consistent with the phase's minimal-surface nature.)*

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies beyond the project's own existing code and already-configured Supabase project (both used by prior phases; no new environment variables, no new packages).

## Sources

### Primary (HIGH confidence — direct code reads)
- `C:\Users\Vanildo\Dev\xphere\src\lib\logger.ts` — full source read; established the exact `log()` contract, its independent Supabase client instantiation, and its never-throws guarantee
- `C:\Users\Vanildo\Dev\xphere\src\lib\obs\logger.ts` — full source read; confirmed a second, separate structured-logger module exists (`createLogger`) which itself forwards `error`-level calls to `event_logs` via a dynamic import of `@/lib/logger`'s `log()` — NOT the recommended path for this phase (it's a broader app-logging abstraction with Sentry forwarding baked in; the two billing call sites should call `log()` directly, matching the `action-engine`/`vapi-webhook` precedent, not adopt the `createLogger()` wrapper for this narrow use)
- `C:\Users\Vanildo\Dev\xphere\src\app\api\stripe\webhook\route.ts` — full source read; exact catch block location and org_id-scoping constraint confirmed
- `C:\Users\Vanildo\Dev\xphere\src\lib\billing\credits.ts` — full source read; exact `meterDebit()` catch block and parameter scoping confirmed
- `C:\Users\Vanildo\Dev\xphere\src\lib\action-engine\execute-action.ts` (lines 40-140) — existing `log()` call-site precedent #1
- `C:\Users\Vanildo\Dev\xphere\src\app\api\vapi\calls\route.ts` (lines 1-140) — existing `log()` call-site precedent #2
- `C:\Users\Vanildo\Dev\xphere\supabase\migrations\1068_event_logs.sql` — full table schema, RLS policies, column comments
- `C:\Users\Vanildo\Dev\xphere\src\app\(admin)\admin\logs\_actions\get-platform-logs.ts` — full source read; confirmed `source` filter + dropdown auto-population, no changes needed
- `C:\Users\Vanildo\Dev\xphere\src\lib\supabase\admin.ts` — confirmed `createServiceRoleClient()` is a distinct client-creation path from `log()`'s internal client
- `C:\Users\Vanildo\Dev\xphere\tests\billing-webhook.test.ts` — full source read; confirmed no `@/lib/logger` mock exists today, exact "processing failure" test location (line 465)
- `C:\Users\Vanildo\Dev\xphere\tests\billing-credit-rpcs.test.ts` — full source read; confirmed no `@/lib/logger` mock exists today, exact "fails OPEN" test locations (lines 62, 70)
- `C:\Users\Vanildo\Dev\xphere\tests\setup\load-env.ts` + `vitest.config.ts` — confirmed real `.env.local` (real service-role key) is loaded in the Vitest environment, which is why an unmocked `log()` call would hit the real DB in CI
- Grep across `src/` for `source:\s*['"]` — full inventory of existing `source` tag values, confirming no collision with `stripe-webhook`/`billing-credits`

### Secondary / Tertiary
None used — this research was fully answerable from direct codebase inspection (HIGH confidence throughout); no external library or web research was needed since the phase is entirely first-party code reuse.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; `log()` helper read in full, both call sites read in full
- Architecture: HIGH — exact insertion points and exact code read for both failure sites; org_id availability constraint verified by reading `handleEvent()` in full
- Pitfalls: HIGH — the test-mocking gap (Pitfall 2) was verified by reading both existing test files in full and confirming no `@/lib/logger` mock exists, plus reading `load-env.ts` to confirm real credentials are loaded in test env

**Research date:** 2026-07-01
**Valid until:** 30 days (stable, first-party code; no external dependency drift risk)

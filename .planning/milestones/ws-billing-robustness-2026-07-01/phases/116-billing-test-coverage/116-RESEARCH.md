# Phase 116: Billing Test Coverage - Research

**Researched:** 2026-07-01
**Domain:** Vitest regression testing for Stripe webhook handling, entitlements precedence, credit-ledger RPCs, and checkout/top-up session creation (Node.js runtime, no browser/component testing involved)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — this phase's CONTEXT.md has no `## Decisions` section. It is an auto-generated infrastructure phase; discussion was skipped.

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure test-authoring phase (BTC-01..04), no user-facing behavior is defined here. Use the ROADMAP phase goal, success criteria, and existing test conventions (Vitest, `tests/` directory, mock patterns already used in `tests/billing-entitlements-unit.test.ts` and `tests/scheduling-bookings.test.ts`) to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BTC-01 | Automated tests cover the Stripe webhook handler (checkout.session.completed, subscription created/updated/deleted, invoice events) including idempotency | Webhook handler read in full (`src/app/api/stripe/webhook/route.ts`); real-signature test strategy via `stripe.webhooks.generateTestHeaderString` (confirmed working against installed SDK v22.2.0); `billing_events` schema and idempotency mechanics documented below |
| BTC-02 | Automated tests cover entitlements resolution precedence (plan_override > subscription > trial > none) | `resolveEffectivePlan()` is ALREADY covered by `tests/billing-entitlements-unit.test.ts` — this phase's job is to confirm/extend coverage, not build from scratch. Exact precedence branches enumerated below |
| BTC-03 | Automated tests cover the credit debit/credit RPCs (dual-bucket draw-down order, ledger entry creation, insufficient-balance behavior) | Exact 4-arg `debit_copilot_credits` RPC body read (migration 1225); dual-bucket draw-down math documented; mock-the-`.rpc()`-call strategy recommended over hitting real Postgres |
| BTC-04 | Automated tests cover checkout session and top-up session creation (correct metadata, correct price IDs) | `createCheckoutSession`/`createCreditTopUpSession` read in full (`src/lib/billing/actions.ts`); exact Stripe SDK call shape and metadata keys documented below |
</phase_requirements>

## Summary

The billing surface is small, well-isolated, and already follows patterns this codebase tests elsewhere (`tests/scheduling-bookings.test.ts`, `tests/twilio-sms-webhook.test.ts`): every I/O boundary (Supabase service-role client, Stripe SDK) is a swappable import, so tests can mock at the module boundary with `vi.mock()` and `vi.mocked(...).mockReturnValue(...)` without touching a real database or the real Stripe API. No new test dependencies are required — `stripe` (already a `dependencies` entry, v22.2.0) ships its own webhook-signing test helper (`generateTestHeaderString`), and Vitest's built-in `vi.mock()` covers everything else.

The one genuinely new pattern this phase must establish is **mocking the `stripe` npm package itself** (`getStripe()` from `src/lib/billing/stripe.ts`) for `actions.ts` (BTC-04), since `stripe.checkout.sessions.create` is not itself something we want to hit over the network. For the webhook handler (BTC-01), the stronger and equally-precedented approach is the **opposite**: do NOT mock `stripe.webhooks.constructEvent` — construct a REAL signed test event with `generateTestHeaderString` and a real HMAC secret, so the signature-verification code path is genuinely exercised (not stubbed away). Both strategies are demonstrated with copy-pasteable code below.

For BTC-02, the pure function `resolveEffectivePlan()` already has a passing, comprehensive unit-test file (`tests/billing-entitlements-unit.test.ts`) covering all four precedence branches plus edge cases (unknown override, uncatalogued price, canceled/unpaid statuses, lapsed trial). BTC-02's job in this phase is to **verify this file's coverage is complete against the current success criteria** ("a case per precedence level") and close any gap — it likely needs zero or near-zero new code, just an audit + possibly 1-2 added cases.

For BTC-03, `credits.ts`'s `meterDebit`/`grantCopilot`/`resetCopilotForPeriod` are all thin `.rpc()` wrappers with almost no branching logic of their own (the actual dual-bucket draw-down math lives in the Postgres function body). Two complementary test layers are needed: (1) unit tests on the **SQL RPC logic itself**, done by mocking `supabase.rpc()`'s return value to simulate what Postgres would compute (fast, no DB dependency, follows existing precedent), and (2) explicitly documenting that the arithmetic tested is a **JS-side re-implementation of the SQL logic for assertion purposes**, not proof the SQL is bug-free — call out this gap honestly rather than hiding it (see Open Questions).

**Primary recommendation:** Use `vi.mock('@/lib/supabase/admin')` + `vi.mock('@/lib/billing/stripe')` (module-boundary mocking, matching `tests/scheduling-bookings.test.ts`) for everything except webhook signature verification, where real signing via `stripe.webhooks.generateTestHeaderString` should be used to exercise the actual `constructEvent` code path unmocked.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.1.2 (installed; 4.1.9 latest on npm) | Test runner | Already the project's only test framework; `vitest.config.ts` has `environment: 'node'`, which is correct for this phase (no component rendering needed) |
| stripe | ^22.2.0 (installed; 22.3.0 latest on npm) | Stripe Node SDK | Already a production dependency; ships `Stripe.webhooks.generateTestHeaderString` + `constructEvent`, both confirmed present and functional on the installed version (verified live in this research session — see Code Examples) |
| @supabase/supabase-js | ^2.101.1 | Supabase client (mocked, not called for real) | Already a production dependency; `createServiceRoleClient()` return value is what gets mocked |

### Supporting
None needed. No `msw`, no `nock`, no `supertest`. The webhook route is a plain Next.js Route Handler exporting `POST(request: Request)`, which can be invoked directly in-process by importing `{ POST }` from the route module and constructing a `new Request(...)` — exactly the pattern `tests/twilio-sms-webhook.test.ts` already uses for a different webhook receiver.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Real signed events via `generateTestHeaderString` | `vi.mock('@/lib/billing/stripe')` and stub `constructEvent` to just return a canned event object | Stubbing `constructEvent` is simpler but skips testing the actual signature-verification branch (400 on bad signature) — since that's an explicit part of the webhook's documented response contract (see the route file's header comment), real signing is worth the small extra setup cost. Use the real-signing approach for the webhook test file; mock `stripe` entirely for `actions.ts` tests instead (different concern — session creation, not signature verification) |
| Mocking `supabase.rpc()` return value (BTC-03) | Spinning up a local Postgres/Supabase instance and running migrations for a true integration test | No local Supabase/Postgres tooling is set up for CI in this repo today (`tests/security-secdef-isolation.test.ts` is the only precedent, and it `describe.skip`s itself when `SUPABASE_*` env vars are absent — i.e., it does NOT run in CI by default). Introducing a new required local-DB dependency is out of scope for a phase whose job is "regression safety net," not "stand up test infra." Mock the RPC call; see Open Questions for the honesty caveat this implies |
| `new Request(...)` + import route handler directly | `supertest` / spinning up a real HTTP server | Every existing webhook test in this repo (`twilio-sms-webhook.test.ts`, presumably others) imports `{ POST }` and calls it directly with a constructed `Request` — no HTTP server needed since Next.js Route Handlers are plain async functions |

**Installation:** None required — all necessary packages are already installed.

**Version verification:**
```bash
npm view stripe version   # 22.3.0 (latest) — installed: 22.2.0 (both have generateTestHeaderString + constructEvent; confirmed live)
npm view vitest version   # 4.1.9 (latest) — installed: 4.1.2 (no relevant API differences for this phase's needs)
```
Both installed versions are current enough; no upgrade is needed for this phase. `stripe@22.2.0` was live-tested in this research session: `generateTestHeaderString({ payload, secret })` produced a valid `t=...,v1=...` header that `constructEvent(payload, header, secret)` successfully verified and parsed back into an `Event` object.

## Architecture Patterns

### Recommended Project Structure
```
tests/
├── billing-webhook.test.ts           # BTC-01 — new file
├── billing-entitlements-unit.test.ts # BTC-02 — EXISTS; audit + extend if gaps found
├── billing-credit-rpcs.test.ts       # BTC-03 — new file
└── billing-checkout-sessions.test.ts # BTC-04 — new file
```
This mirrors the existing flat `tests/` directory convention (no subfolder per domain unless already established — `billing-*` prefix already used by `billing-entitlements-unit.test.ts`, `billing-credits-indicator.test.ts`, `billing-credits-visibility.test.ts`).

### Pattern 1: Real signed Stripe webhook events (BTC-01)
**What:** Build a real, validly-signed Stripe event payload in the test using `stripe.webhooks.generateTestHeaderString`, and pass it through the actual route handler's `constructEvent` call — no mocking of Stripe's signature verification at all.
**When to use:** Any test asserting behavior of `POST` in `src/app/api/stripe/webhook/route.ts`, including the 400-on-bad-signature case (send a header signed with the WRONG secret) and the 400-on-missing-signature case (omit the header).
**Example:**
```typescript
// Source: verified live against installed stripe@22.2.0 in this research session
import Stripe from 'stripe'

const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_vitest'
process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy' // required by getStripe(), never called for a real API request in these tests

// Stripe() only needs a key to construct — webhooks.generateTestHeaderString does
// not make a network call, so a dummy key is fine here.
const stripeForSigning = new Stripe(process.env.STRIPE_SECRET_KEY)

function buildSignedRequest(event: Partial<Stripe.Event>, secret = STRIPE_WEBHOOK_SECRET): Request {
  const payload = JSON.stringify({
    id: 'evt_test_123',
    object: 'event',
    api_version: '2026-05-27.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    ...event,
  })
  const signature = stripeForSigning.webhooks.generateTestHeaderString({ payload, secret })
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
  })
}

// Bad-signature case: sign with a DIFFERENT secret than the route expects.
const badRequest = buildSignedRequest({ type: 'checkout.session.completed' }, 'whsec_WRONG_secret')
```
This is the ONLY reliable way to exercise the route's actual `getStripe().webhooks.constructEvent(rawBody, signature, secret)` call without mocking it away — and per the route's own header comment, correctly rejecting bad signatures (400) vs. accepting valid ones is a documented part of its contract, worth testing for real.

### Pattern 2: Mock Supabase service-role client for webhook DB writes (BTC-01)
**What:** `vi.mock('@/lib/supabase/admin')` and provide a `from()` proxy keyed by table name, following the exact style of `buildFakeAdmin()` in `tests/scheduling-bookings.test.ts` and `buildMockSupabase()` in `tests/twilio-sms-webhook.test.ts`.
**When to use:** Testing `billing_events` idempotency (upsert + processed_at check), and indirectly `syncSubscription`/`grantCopilot` if not separately mocked.
**Example:**
```typescript
// Source: adapted from tests/scheduling-bookings.test.ts buildFakeAdmin() pattern
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/billing/sync', () => ({ syncSubscription: vi.fn() }))
vi.mock('@/lib/billing/customers', () => ({ resolveOrgIdByCustomer: vi.fn() }))
vi.mock('@/lib/billing/credits', () => ({
  grantCopilot: vi.fn(),
  resetCopilotForPeriod: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'

function buildFakeAdmin(billingEventsRow: { processed_at: string | null } | null) {
  const upsertSpy = vi.fn(() => ({ /* upsert result not read by route */ }))
  const updateSpy = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }))
  return {
    from: vi.fn((table: string) => {
      if (table === 'billing_events') {
        return {
          upsert: upsertSpy,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: billingEventsRow, error: null }),
          update: updateSpy,
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    }),
  }
}
```
**Important nuance:** the route calls `.from('billing_events').upsert(...)` then a SEPARATE `.from('billing_events').select('processed_at').eq(...).maybeSingle()`, then (on success) `.from('billing_events').update({ processed_at }).eq(...)`. All three must be satisfied by the SAME `from('billing_events')` mock object (it's called 2-3 times, not chained) — verify with `fromMock.mock.calls.filter(c => c[0] === 'billing_events').length` if you need to assert call count, but functionally a single object with `upsert`, `select().eq().maybeSingle()`, and `update().eq()` all present handles every call.

### Pattern 3: Mock `getStripe()` for `actions.ts` session creation (BTC-04)
**What:** `vi.mock('@/lib/billing/stripe')` replacing `getStripe` with a `vi.fn()` returning an object shaped like the subset of the Stripe SDK the actions actually call (`checkout.sessions.create`, `billingPortal.sessions.create`).
**When to use:** Testing `createCheckoutSession`, `createPortalSession`, `createCreditTopUpSession` — none of which should make a real network call.
**Example:**
```typescript
// Source: pattern modeled on tests/scheduling-bookings.test.ts's per-dependency vi.mock style
vi.mock('@/lib/billing/stripe', () => ({
  getStripe: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
}))
vi.mock('@/lib/billing/customers', () => ({
  getOrCreateStripeCustomer: vi.fn(async () => 'cus_test_123'),
}))
vi.mock('@/lib/billing/context', () => ({
  getBillingContext: vi.fn(async () => ({ userId: 'u1', orgId: 'org-1', isAdmin: true })),
  getBaseUrl: vi.fn(async () => 'https://xphere.app'),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getStripe } from '@/lib/billing/stripe'
import { createCheckoutSession, createCreditTopUpSession } from '@/lib/billing/actions'

const createSessionSpy = vi.fn(async () => ({ url: 'https://checkout.stripe.com/test' }))
vi.mocked(getStripe).mockReturnValue({
  checkout: { sessions: { create: createSessionSpy } },
} as any)

process.env.STRIPE_PRICE_PRO = 'price_pro_test'

await createCheckoutSession('pro')

expect(createSessionSpy).toHaveBeenCalledWith(
  expect.objectContaining({
    mode: 'subscription',
    customer: 'cus_test_123',
    line_items: [{ price: 'price_pro_test', quantity: 1 }],
    metadata: { org_id: 'org-1' },
    subscription_data: { metadata: { org_id: 'org-1' } },
  }),
)
```
For `createCreditTopUpSession`, assert `mode: 'payment'`, `metadata: { org_id, kind: 'copilot_topup', package: packageKey }`, and `payment_intent_data.metadata` with the same three keys — these are the exact metadata shapes the webhook reads back on `checkout.session.completed` (see route.ts lines 112-127), so a metadata-shape mismatch here is a real regression the webhook test (BTC-01) would NOT catch (different test, different code path) — both need their own explicit assertions.

### Pattern 4: Mock `.rpc()` return value for credit RPC tests (BTC-03)
**What:** `vi.mock('@/lib/supabase/admin')`, mock the `.rpc()` method directly (not `.from()`), and return the exact `jsonb` shape the Postgres functions produce (`{ allowed, balance_after }` for debit; a bare `numeric` for credit/reset).
**When to use:** Testing `meterDebit`, `grantCopilot`, `resetCopilotForPeriod` in `src/lib/billing/credits.ts`.
**Example:**
```typescript
// Source: pattern modeled on the .rpc() call shape in src/lib/billing/credits.ts + the
// exact return contract of debit_copilot_credits in supabase/migrations/1225_metering_reason.sql
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { meterDebit } from '@/lib/billing/credits'

const rpcSpy = vi.fn(async (fnName: string, args: Record<string, unknown>) => {
  if (fnName === 'debit_copilot_credits') {
    // Simulate the SQL function's dual-bucket draw-down for a $5 debit against
    // included=3, topup=10: take_inc = min(3, 5) = 3; inc becomes 0;
    // top becomes 10 - (5-3) = 8; total = 8.
    return { data: { allowed: true, balance_after: 8 }, error: null }
  }
  return { data: null, error: null }
})
vi.mocked(createServiceRoleClient).mockReturnValue({ rpc: rpcSpy } as any)

const result = await meterDebit('org-1', 'copilot_turn', 5, 'run-123')

expect(rpcSpy).toHaveBeenCalledWith('debit_copilot_credits', {
  p_org_id: 'org-1',
  p_amount_usd: 5,
  p_run_id: 'run-123',
  p_reason: 'copilot_turn',
})
expect(result).toEqual({ allowed: true, balanceAfter: 8 })
```
For the insufficient-balance case, simulate `{ allowed: false, balance_after: -2 }` (the SQL always allows the debit to apply and go negative — "allowed" reflects `v_total > 0` AFTER the debit, not a pre-check refusal) and assert `meterDebit` surfaces `allowed: false` correctly. For the RPC-error case (e.g. Postgres exception), return `{ data: null, error: { message: '...' } }` and assert `meterDebit` catches it and fails OPEN (`{ allowed: true, balanceAfter: 0 }`) per its documented contract — this fail-open behavior is exactly what BOB-02 (next phase) will need a regression test to guard, so get it right here.

### Anti-Patterns to Avoid
- **Mocking `constructEvent` directly in BTC-01 tests:** Defeats the purpose of testing the webhook's documented signature-verification contract. Use real signing via `generateTestHeaderString` instead (see Pattern 1).
- **Hard-coding the dual-bucket draw-down arithmetic as "the truth" without noting it mirrors SQL, not verifies it:** The RPC mock in Pattern 4 encodes the SAME math the Postgres function computes — that's necessary to write a meaningful assertion, but it means the JS test does NOT catch a bug in the actual SQL function body. Document this explicitly (see Open Questions) rather than presenting the mocked RPC test as full proof of RPC correctness.
- **Testing `getEntitlements()` (the IO wrapper) instead of `resolveEffectivePlan()` (the pure function):** `getEntitlements` requires `getActiveOrg()` + two Supabase reads + React `cache()`; it's far more complex to mock for equivalent value. The existing test file correctly targets the pure function only — keep doing that.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Constructing a validly HMAC-signed Stripe webhook payload | A manual `crypto.createHmac('sha256', ...)` replica of Stripe's signing scheme | `stripe.webhooks.generateTestHeaderString({ payload, secret })` | It's the official SDK helper, purpose-built for exactly this test scenario, confirmed present and working in the installed version — reinventing Stripe's signing scheme risks subtle timestamp/tolerance bugs `constructEvent` would then reject |
| Simulating Postgres row-level locking / concurrent debit races | A custom in-memory mutex or queue in the test mock | Not needed for this phase — `FOR UPDATE` row-lock correctness under concurrency is a database-level guarantee, out of scope for a Vitest unit test that mocks `.rpc()` entirely. If concurrency testing is ever wanted, it requires a real Postgres instance (out of scope here; flag as a v2 idea if raised) | |

**Key insight:** Nothing in this phase requires new test infrastructure or new dependencies. The entire job is applying an established mocking pattern (module-boundary `vi.mock()`, already used four-plus times in this codebase) to four previously-untested files.

## Runtime State Inventory

Not applicable — this is a pure test-authoring phase (BTC-01..04). No renames, refactors, or migrations of existing runtime state are involved. Skipping this section per its trigger condition.

## Common Pitfalls

### Pitfall 1: Webhook route's raw-body requirement breaks if you parse-then-restringify
**What goes wrong:** The route calls `await request.text()` for the RAW body BEFORE any JSON parsing, because Stripe's signature is computed over the exact raw bytes. If a test constructs the `Request` body by first `JSON.parse`-ing then `JSON.stringify`-ing (e.g., to "pretty" it), whitespace/key-order differences will silently invalidate the signature.
**Why it happens:** `JSON.stringify` is not guaranteed byte-stable across re-serialization if the object was mutated or reconstructed.
**How to avoid:** Compute `payload = JSON.stringify(eventObject)` exactly ONCE, pass that exact string both to `generateTestHeaderString({ payload, secret })` AND as the `Request` body. Never re-derive the payload string separately for signing vs. sending.
**Warning signs:** Test fails with "Signature verification failed" even though secrets match — check for accidental double-serialization.

### Pitfall 2: `billing_events` mock must handle 2-3 sequential calls to `.from('billing_events')`, not one chained call
**What goes wrong:** The route does an `upsert`, then a separate `select().eq().maybeSingle()`, then (on success) an `update().eq()` — three DISTINCT calls to `supabase.from('billing_events')`, not one fluently-chained query. A mock that only implements a single method chain will throw `undefined is not a function` on the second or third call.
**Why it happens:** Copy-pasting a simpler single-query mock (like the notifications examples) without checking how many times `.from(...)` is invoked for that table.
**How to avoid:** Read the route file's exact sequence (lines 60-87) and provide `upsert`, `select().eq().maybeSingle()`, and `update().eq()` all on the object returned by the `from('billing_events')` mock factory — see Pattern 2 above.
**Warning signs:** `TypeError: supabase.from(...).select is not a function` or similar — usually means the mock object returned for that table doesn't have every method the route calls in sequence.

### Pitfall 3: `invoice.paid` / `invoice.payment_failed` need `stripe.subscriptions.retrieve` mocked too
**What goes wrong:** `handleEvent`'s invoice branch calls `await stripe.subscriptions.retrieve(subId)` (a SECOND Stripe API call, not just the webhook's `constructEvent`). If only `constructEvent`/signing is handled and `stripe.subscriptions.retrieve` isn't separately mocked, the test will throw or hang trying to reach the real Stripe API.
**Why it happens:** The webhook handler doesn't just parse the event — for `checkout.session.completed` (subscription mode) and both invoice events, it calls back into `stripe.subscriptions.retrieve(...)` to get the FULL subscription object (Stripe's invoice event doesn't embed it directly in older API-version shapes).
**How to avoid:** Mock `getStripe` (via `vi.mock('@/lib/billing/stripe')`) for the parts of the test that need `stripe.subscriptions.retrieve` to return a canned `Stripe.Subscription`-shaped object — but keep using a REAL un-mocked `Stripe` instance (or the actual imported module, not mocked) purely for `generateTestHeaderString`/`constructEvent` in the SAME test file. These are two different concerns: `getStripe()` (mocked, used by the route) vs. a separate `new Stripe(...)` instance the TEST constructs just for signing (not mocked, not the same call the route makes).
**Warning signs:** Test hangs or throws a real network error ("Invalid API Key provided") — means `stripe.subscriptions.retrieve` wasn't mocked and the code tried a live call.

### Pitfall 4: `invoiceSubscriptionId()` reads from `invoice.parent.subscription_details.subscription` first, with a legacy top-level fallback
**What goes wrong:** A test payload built with only the "obvious" `invoice.subscription` field (old Stripe API shape) will still work due to the fallback, but a test asserting the NEW-shape field is exercised needs to nest it correctly: `invoice.parent.subscription_details.subscription`.
**Why it happens:** The pinned API version (`2026-05-27.dahlia` per `stripe.ts`) moved this field under `invoice.parent`; the route supports both shapes defensively.
**How to avoid:** When constructing invoice event fixtures, use the field shape matching the pinned API version (`parent.subscription_details.subscription`) as the primary path tested, and add ONE test using the legacy top-level `subscription` field to prove the fallback still works.
**Warning signs:** `invoiceSubscriptionId` returns `null` and the sync/refresh logic silently no-ops — the route treats this as "no subscription found," not an error, so a wrongly-shaped test fixture fails silently (no thrown error) rather than loudly. Assert explicitly that `syncSubscription`/`refreshCopilotAllowance` mocks WERE called, not just that the response was 200.

### Pitfall 5: `debit_copilot_credits`'s "allowed" is a POST-hoc signal, not a pre-check gate
**What goes wrong:** Asserting `allowed: false` means "the debit was rejected" is WRONG — the SQL function always applies the debit (can go negative) and `allowed` just reports whether the resulting balance is still `> 0`. A naive test might assert the balance is unchanged when `allowed: false`, which contradicts the actual (intentional) behavior.
**Why it happens:** The doc comment in `credits.ts` (lines 180-189) explains this is deliberate: "Always applies (we never lose a real cost) and may drive the balance negative; the pre-turn check gates the NEXT action, not this one."
**How to avoid:** In the insufficient-balance test case, assert the ledger entry WAS created with the full debited amount (not clamped), the balance went negative, AND `allowed: false` is returned — all three, not just the last one.
**Warning signs:** A test that only checks `result.allowed === false` without also asserting the balance/ledger side effects is under-specified for BTC-03's stated success criterion ("insufficient-balance behavior").

## Code Examples

### Complete idempotency test skeleton for BTC-01
```typescript
// Source: composed from route.ts read in full + Pattern 1/2/3 above
it('a duplicate delivery of the same event id is a no-op (200, duplicate:true)', async () => {
  const fakeAdmin = buildFakeAdmin({ processed_at: '2026-07-01T00:00:00.000Z' }) // already processed
  vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin as any)

  const request = buildSignedRequest({ id: 'evt_dup_1', type: 'checkout.session.completed', data: { object: {} } })
  const { POST } = await import('@/app/api/stripe/webhook/route')
  const response = await POST(request)

  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toEqual({ received: true, duplicate: true })
})
```

### Precedence-per-level audit checklist for BTC-02 (against existing test file)
```
Existing coverage in tests/billing-entitlements-unit.test.ts — confirm each is present:
  [x] override wins over subscription+trial   -> 'resolveEffectivePlan — precedence' > "override wins..."
  [x] active subscription (no override)       -> 'resolveEffectivePlan — subscription' > "active subscription..."
  [x] trial (no override, no subscription)    -> 'resolveEffectivePlan — trial & none' > "a future trial..."
  [x] none (nothing grants access)            -> 'resolveEffectivePlan — trial & none' > "no trial window..."
All four precedence levels already have a dedicated case. BTC-02 is DONE upon audit
confirmation; if the planner wants an explicit "one test per precedence level in a
single describe block" structure for traceability, that's a light refactor/rename
of existing tests, not new logic.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A | N/A | N/A | This phase deals with stable, already-current tooling (Vitest 4.x, Stripe SDK 22.x) — no deprecated API surface was found during research |

**Deprecated/outdated:** None identified. The `invoiceSubscriptionId()` helper in the route already defensively handles a past API shape change (`invoice.subscription` → `invoice.parent.subscription_details.subscription`), which is itself evidence the team tracks Stripe API version changes proactively.

## Open Questions

1. **Does a mocked-RPC test for BTC-03 actually verify the SQL function's correctness, or only the JS wrapper's call/response handling?**
   - What we know: `credits.ts`'s `meterDebit`/`grantCopilot`/`resetCopilotForPeriod` contain almost no logic — they format arguments, call `.rpc()`, and reshape the response. The actual dual-bucket draw-down math lives entirely in the Postgres function body (migration 1225).
   - What's unclear: Mocking `.rpc()` to return a hand-computed `{ allowed, balance_after }` proves the JS wrapper calls the RPC with the right arguments and handles the response/error shape correctly — it does NOT execute or verify the actual SQL. A bug in the SQL (e.g., wrong draw-down order) would NOT be caught by this test strategy.
   - Recommendation: Proceed with mocking (consistent with existing precedent and CONTEXT.md's discretion to avoid new infra), but the plan's task description and/or test file's header comment should explicitly say "this verifies the RPC wrapper's contract; it does not execute the SQL function" — same honesty pattern this research file follows. If true SQL-level coverage is later wanted, it requires a real Postgres/Supabase test instance (a bigger lift, arguably its own future phase, not BTC-03's scope).

2. **Should `getStripe()`'s lazy singleton caching (`let cached: Stripe | null = null` in stripe.ts) cause cross-test pollution?**
   - What we know: `getStripe()` caches the `Stripe` instance at module scope after first construction. If `vi.mock('@/lib/billing/stripe')` replaces the whole module (Pattern 3), this caching is irrelevant (the mock's `getStripe` is a fresh `vi.fn()` per test file). But if any test does NOT mock `@/lib/billing/stripe` and instead relies on env vars across multiple `it()` blocks in the same file, the singleton could leak stale state (e.g., an API key set in one test persists to the next).
   - What's unclear: Whether any planned test needs the REAL `getStripe()` (unmocked) more than once per file with different env var configurations.
   - Recommendation: For BTC-01 (webhook), do NOT mock `@/lib/billing/stripe` at all for signing purposes (use a locally-constructed `new Stripe(...)` in the test, per Pattern 1's `stripeForSigning`) — sidesteps the singleton entirely. For BTC-04 (actions.ts), always mock `@/lib/billing/stripe` (Pattern 3) so the singleton is never exercised in tests.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| stripe (npm package) | BTC-01, BTC-04 signing/mocking | Yes | 22.2.0 installed (22.3.0 latest) | — |
| vitest | All BTC-01..04 | Yes | 4.1.2 installed (4.1.9 latest) | — |
| Local/CI Postgres or Supabase instance | Would be needed ONLY for true SQL-level RPC testing | No — not configured for CI in this repo (`security-secdef-isolation.test.ts` is the only precedent and self-skips without `SUPABASE_*` env vars) | — | Mock `.rpc()` at the Supabase client boundary instead (see Pattern 4) — this is the recommended path, not a degraded fallback |
| `STRIPE_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` env vars in `.env.local` | Not required for these tests | N/A | — | Tests should set these via `process.env.X = '...'` inline (dummy test values), matching how `billing-entitlements-unit.test.ts` already sets `process.env.STRIPE_PRICE_PRO` inline per-test |

**Missing dependencies with no fallback:** None — every dependency needed for this phase's recommended approach is already present.

**Missing dependencies with fallback:** Local Postgres/Supabase for true RPC integration testing is absent, but the recommended mocking approach (Pattern 4) is a full substitute for this phase's stated scope (a JS-level regression safety net, not a SQL correctness proof — see Open Question 1).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (`vitest.config.ts`: `environment: 'node'`, `globals: true`, setup file `tests/setup/load-env.ts`) |
| Config file | `C:\Users\Vanildo\Dev\xphere\vitest.config.ts` |
| Quick run command | `npx vitest run tests/billing-webhook.test.ts tests/billing-entitlements-unit.test.ts tests/billing-credit-rpcs.test.ts tests/billing-checkout-sessions.test.ts` |
| Full suite command | `npm test` (runs `vitest run` — entire `tests/**/*.test.ts` glob) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BTC-01 | Webhook handles checkout.session.completed, subscription created/updated/deleted, invoice.paid/payment_failed, and duplicate-event idempotency | unit (mocked Supabase + Stripe subscriptions.retrieve; REAL signature verification) | `npx vitest run tests/billing-webhook.test.ts` | ❌ Wave 0 — new file |
| BTC-02 | Entitlements precedence: override > subscription > trial > none, one case per level | unit (pure function, no mocks) | `npx vitest run tests/billing-entitlements-unit.test.ts` | ✅ Already exists — audit for completeness, extend if gaps found |
| BTC-03 | Credit RPC dual-bucket draw-down order, ledger entry creation, insufficient-balance behavior | unit (mocked `supabase.rpc()`) | `npx vitest run tests/billing-credit-rpcs.test.ts` | ❌ Wave 0 — new file |
| BTC-04 | Checkout/top-up session creation: correct metadata, correct price IDs | unit (mocked `getStripe`, `getOrCreateStripeCustomer`, `getBillingContext`) | `npx vitest run tests/billing-checkout-sessions.test.ts` | ❌ Wave 0 — new file |

### Sampling Rate
- **Per task commit:** `npx vitest run <specific new/modified test file>`
- **Per wave merge:** `npm test` (full suite — confirms no cross-file mock leakage, e.g. global `process.env` pollution between billing test files)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/billing-webhook.test.ts` — covers BTC-01 (new file)
- [ ] `tests/billing-credit-rpcs.test.ts` — covers BTC-03 (new file)
- [ ] `tests/billing-checkout-sessions.test.ts` — covers BTC-04 (new file)
- [ ] Audit `tests/billing-entitlements-unit.test.ts` for BTC-02 completeness (likely no gap — see State of the Art / Code Examples precedence checklist above); extend only if the audit finds a genuinely missing case
- No framework install needed — Vitest, `stripe`, and `@supabase/supabase-js` are all already present as dependencies.

## Sources

### Primary (HIGH confidence)
- `C:\Users\Vanildo\Dev\xphere\src\app\api\stripe\webhook\route.ts` — full webhook handler read, including response-contract header comment
- `C:\Users\Vanildo\Dev\xphere\src\lib\billing\entitlements.ts` — full `resolveEffectivePlan`/`getEntitlements` read
- `C:\Users\Vanildo\Dev\xphere\src\lib\billing\actions.ts` — full server actions read
- `C:\Users\Vanildo\Dev\xphere\src\lib\billing\credits.ts` — full credit wallet facade read
- `C:\Users\Vanildo\Dev\xphere\src\lib\billing\sync.ts`, `customers.ts`, `context.ts`, `plans.ts`, `stripe.ts`, `catalog.ts`, `guards.ts`, `config.ts` — full reads
- `C:\Users\Vanildo\Dev\xphere\supabase\migrations\1153_stripe_billing_foundation.sql` — `billing_customers`/`billing_subscriptions`/`billing_events` exact schema
- `C:\Users\Vanildo\Dev\xphere\supabase\migrations\1207_billing_trial_and_plan_override.sql` — `trial_ends_at`/`plan_override` columns
- `C:\Users\Vanildo\Dev\xphere\supabase\migrations\1208_copilot_credits.sql` — original 3-arg RPC bodies (debit/credit/reset), table shapes, RLS/grants
- `C:\Users\Vanildo\Dev\xphere\supabase\migrations\1225_metering_reason.sql` — current 4-arg `debit_copilot_credits` (the shape BTC-03 must test against)
- `C:\Users\Vanildo\Dev\xphere\tests\billing-entitlements-unit.test.ts` — existing BTC-02-relevant coverage, read in full
- `C:\Users\Vanildo\Dev\xphere\tests\scheduling-bookings.test.ts` — the closest existing precedent for mocking Supabase admin client + verb-routed table proxies (correcting the prompt's reference to a non-existent `tests/scheduling-bookings.test.ts` filename — the actual file is at this path with header comment literally titled "tests/scheduling-bookings.test.ts" despite living at `tests/calendar-bookings.test.ts`)
- `C:\Users\Vanildo\Dev\xphere\tests\twilio-sms-webhook.test.ts` — precedent for testing a webhook Route Handler directly via `new Request(...)` + imported `POST`, including real HMAC signing (analogous pattern to Stripe's, for a different provider)
- `C:\Users\Vanildo\Dev\xphere\tests\security-secdef-isolation.test.ts` — precedent for real-DB-backed tests, confirmed `describe.skip`-gated on `SUPABASE_*` env vars (i.e., not a CI-required pattern)
- `C:\Users\Vanildo\Dev\xphere\package.json` — confirmed `stripe: ^22.2.0`, `vitest: ^4.1.2`, no `msw`/`nock`/`supertest`
- `C:\Users\Vanildo\Dev\xphere\vitest.config.ts` — confirmed `environment: 'node'`, path alias setup, `server-only` stub
- Live verification in this research session: `node -e "..."` constructing `new Stripe('sk_test_x')`, calling `webhooks.generateTestHeaderString({ payload, secret })`, and successfully round-tripping through `webhooks.constructEvent(payload, header, secret)` — confirms the installed SDK version supports the recommended test-signing approach
- `npm view stripe version` (22.3.0) / `npm view vitest version` (4.1.9) — registry version check confirming installed versions are current

### Secondary (MEDIUM confidence)
None used — all findings were verifiable directly against the repo's own source and a live SDK check, no external web search was needed for this phase's scope.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package is already installed and version-confirmed; no new dependencies needed
- Architecture: HIGH — all four test targets were read in full; mocking patterns are directly modeled on three existing, working test files in this exact repo
- Pitfalls: HIGH — each pitfall traces to a specific line/behavior in the actual source files read during this research, not speculation

**Research date:** 2026-07-01
**Valid until:** 2026-08-01 (30 days — stable domain: internal code + a pinned-version SDK, low churn risk)

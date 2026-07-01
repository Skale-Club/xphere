# Phase 115: Credit Balance Visibility - Research

**Researched:** 2026-07-01
**Domain:** Next.js App Router server/client prop threading + Supabase Realtime (postgres_changes) + shadcn Popover UI, inside an existing billing feature surface
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Layout & Visual Design**
- Indicator placed in `TopBar` (`src/components/layout/top-bar.tsx`) between `ThemeToggle` and `OrgSwitcher`, following the existing `NotificationBell` visual pattern (`Button variant="ghost" size="icon-sm"`)
- Display format: icon (`Sparkles`, already used in `CreditsCard`) + rounded credit count via the existing `toCredits()` conversion; hidden on mobile via the same `hidden sm:flex` wrapper used for other desktop-only TopBar actions
- Click opens a `Popover` (matching `NotificationBell`'s `Popover`/`PopoverContent` pattern) showing included/topup breakdown plus a "Manage billing" link to `/settings/billing` — not a direct navigation
- Mobile: added to the `MobileMenu` Quick Actions grid (alongside Dial pad / Notifications / Theme), matching that 3-icon grid pattern

**Visibility Gating**
- Gated on the org's resolved plan (`copilotIncludedUsd > 0` from `PLAN_CATALOG`, or an existing non-empty `copilot_credit_balances` row), NOT on `isBillingEnforced()` — the indicator must be visible today even though enforcement is currently off, since that's the entire point of this phase
- `getCopilotBalance(activeOrgId)` is fetched directly in `(dashboard)/layout.tsx` (a plain balance-table read, no dependency on the existing `isBillingEnforced()`-gated `getEntitlements()` call) and passed down as a prop through `TopBar`
- Hide only when the org has no billing relationship at all (no plan resolves to a nonzero `copilotIncludedUsd` and no existing balance row) — do not hide simply because enforcement is off

**Live Update Mechanism**
- Supabase Realtime subscription on `copilot_credit_balances`, scoped to the org's row, following the exact channel-subscribe/cleanup pattern already established in `NotificationBell` (`supabase.channel(...)`, `.on('postgres_changes', ...)`, cleanup on unmount)
- `copilot_credit_balances` does NOT currently have Realtime publication enabled — a new migration is required in this phase (`ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_credit_balances`, following the precedent of migration 024 for `conversations`/`conversation_messages`)
- No special-casing for the top-up checkout redirect — Realtime will naturally pick up the Stripe webhook's balance update; `CreditsCard`'s existing `topupResult` toast logic on `/settings/billing` is untouched
- Balance number updates instantly on Realtime event, no pulse/highlight animation (Claude's discretion, kept simple)

### Claude's Discretion
- Exact Popover width/spacing details, matching existing `w-80` sizing used by `NotificationBell`'s popover content
- Whether to reuse `CreditsCard`'s `toCredits()` import directly or re-export it — prefer importing the existing helper, not duplicating

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. Low-balance alert/blocking UX beyond the indicator's own visual state change is explicitly deferred (see REQUIREMENTS.md v2 MET-08).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CRB-01 | Persistent credit balance indicator (included + topup) in global header on every dashboard page, when org's plan includes credits | `TopBar`/`(dashboard)/layout.tsx` integration points below; `getCopilotBalance()` already returns `includedUsd`/`topupUsd`/`totalUsd` — no backend change needed |
| CRB-02 | Indicator updates without full page reload after a debit or top-up | Realtime `postgres_changes` subscription pattern (exact `NotificationBell` template) + new migration 1226 enabling publication on `copilot_credit_balances` |
| CRB-03 | Indicator hidden/empty-state for orgs without a credit-bearing plan | Plan-resolution logic below (`PLAN_CATALOG[planKey]?.copilotIncludedUsd > 0` OR non-empty balance row), computed independently of `isBillingEnforced()` |
| CRB-04 | Distinct visual state (color/badge) when balance is low/zero, clickable to billing settings | UI-SPEC.md already locks the 3-state threshold logic (healthy/low/zero) and badge geometry; "Manage billing" link to `/settings/billing` inside popover |
</phase_requirements>

## Summary

This phase adds exactly one new client component (`CreditsIndicator`) plus small, additive prop-threading changes to two existing files (`(dashboard)/layout.tsx`, `top-bar.tsx`), and one new migration enabling Supabase Realtime on an existing table. There is no new backend logic: `getCopilotBalance(orgId)` (in `src/lib/billing/credits.ts`) already returns the exact shape the UI needs (`includedUsd`, `topupUsd`, `totalUsd`, `includedAllowanceUsd`, `periodEnd`), and it reads via a service-role client — meaning it can be called unconditionally in the dashboard layout with no RLS setup and no dependency on `isBillingEnforced()`.

The entire feature is a direct structural clone of `NotificationBell` (`src/components/notifications/notification-bell.tsx`): same `Popover`/`PopoverContent` trigger pattern, same Realtime channel-subscribe-then-cleanup effect shape, same badge-overlay-on-trigger-icon convention. The one genuinely new piece of logic is the plan-includes-credits boolean used for CRB-03 gating, which must be computed server-side in the dashboard layout without depending on the enforcement-gated `getEntitlements()` — this requires reading `organizations.plan_override` / the live subscription's plan directly, OR the simpler fallback of just checking whether `copilot_credit_balances` has a non-empty row for the org. Both approaches are documented below with a recommended approach.

**Primary recommendation:** Clone `NotificationBell`'s component structure almost verbatim into a new `src/components/billing/credits-indicator.tsx`, call `getCopilotBalance(activeOrgId)` directly in `(dashboard)/layout.tsx` (parallel to, not replacing, the existing `entitlements` computation), and add migration `1226_copilot_credits_realtime.sql` copying the exact idempotent `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` wrapper from migration `024_chat_realtime_publication.sql`. The migration and the component/layout work are fully independent and can be built in parallel — the Realtime migration only affects live-update behavior (CRB-02), while the component renders and reads its initial balance correctly even before the migration lands (Realtime subscribe simply won't receive events until the publication exists).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.101.1 (installed) | Realtime `postgres_changes` channel subscription | Already the sole Realtime mechanism in this codebase (`NotificationBell`, call-log dialer) |
| `@supabase/ssr` | ^0.10.0 (installed) | `createClient()` used by `getCopilotBalance` server read | Existing pattern, no change |
| React | ^19.0.0 (installed) | `useState`/`useEffect`/`useId` in new client component | Matches `NotificationBell` exactly |
| Next.js | ^16.2.6 (installed) | Server component prop threading through `(dashboard)/layout.tsx` → `TopBar` | Existing App Router pattern |
| lucide-react | (installed, version pinned in package.json — already used) | `Sparkles` icon (already imported in `CreditsCard`) | UI-SPEC.md locks this icon choice |

### Supporting
No new libraries needed. Everything required (`Popover`, `PopoverContent`, `PopoverTrigger`, `Button`) is already installed via shadcn and used by `NotificationBell`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Realtime `postgres_changes` on `copilot_credit_balances` | Client-side polling (`setInterval` re-fetch) | CONTEXT.md explicitly locks Realtime; polling would violate CRB-02's "without a full page reload" intent and duplicate an already-established pattern |
| New migration enabling publication | Broadcast-based Realtime (`supabase.channel().send()`) from the debit/credit RPCs | Would require modifying the RPCs (`debit_copilot_credits`, `credit_copilot_credits`) — out of scope; `postgres_changes` requires zero RPC changes, just the publication grant |

**Installation:** No new packages required — nothing to install.

**Version verification:** All versions above were read directly from the project's `package.json` (not training-data assumptions); no registry lookup needed since no new packages are being added.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── components/
│   ├── billing/
│   │   ├── credits-card.tsx          # existing — reuse toCredits(), KIND_LABEL patterns
│   │   └── credits-indicator.tsx     # NEW — the TopBar/MobileMenu component (CRB-01..04)
│   ├── notifications/
│   │   └── notification-bell.tsx     # existing — direct structural template
│   └── layout/
│       └── top-bar.tsx               # MODIFIED — add CreditsIndicator to desktop row + MobileMenu grid
├── app/(dashboard)/
│   └── layout.tsx                    # MODIFIED — add getCopilotBalance() call + plan-includes-credits resolution
└── lib/billing/
    ├── credits.ts                    # UNCHANGED — getCopilotBalance() already returns the needed shape
    └── catalog.ts                    # UNCHANGED — PLAN_CATALOG[key].copilotIncludedUsd already exists
supabase/migrations/
└── 1226_copilot_credits_realtime.sql # NEW — enables Realtime publication (next number after 1225)
```

### Pattern 1: Realtime Channel Subscribe/Cleanup (exact template)
**What:** A `'use client'` component opens a Supabase Realtime channel scoped to a single row filter on mount, updates local state on the `UPDATE` event, and tears the channel down on unmount.
**When to use:** Any component needing live server-pushed state without polling — this is the codebase's established pattern (also used by the outbound call dialer on `call_logs`).
**Example:**
```typescript
// Source: src/components/notifications/notification-bell.tsx (lines 79-125), the CONTEXT.md-designated template
React.useEffect(() => {
  if (!orgId) return

  const supabase = createClient()
  const channel = supabase.channel(`copilot-credits:${orgId}:${instanceId}`)

  channel.on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'copilot_credit_balances',
      filter: `org_id=eq.${orgId}`,
    },
    (payload) => {
      const row = payload.new as {
        included_balance_usd: string | number
        topup_balance_usd: string | number
        included_allowance_usd: string | number
      }
      setBalance({
        includedUsd: Number(row.included_balance_usd),
        topupUsd: Number(row.topup_balance_usd),
        totalUsd: Number(row.included_balance_usd) + Number(row.topup_balance_usd),
        includedAllowanceUsd: Number(row.included_allowance_usd),
      })
    },
  )

  channel.subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}, [instanceId, orgId])
```
Note: `payload.new` field names are the raw **snake_case DB column names** (`included_balance_usd`, not `includedUsd`) — the realtime payload is NOT run through the same mapping function as `getCopilotBalance()`'s initial server read. The component must re-map fields itself in the event handler (as shown above), it cannot reuse the `CopilotBalance` interface's camelCase shape directly from the payload.

### Pattern 2: Popover Trigger with Conditional Badge Overlay
**What:** A ghost icon-button `PopoverTrigger` with an absolutely-positioned badge `<span>` that only renders conditionally (empty/no-badge in the default state).
**When to use:** TopBar icon-triggered popovers needing a "something needs attention" visual cue.
**Example:**
```typescript
// Source: src/components/notifications/notification-bell.tsx (lines 144-172)
<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Credit balance"
      className="relative text-text-secondary hover:text-text-primary"
    >
      <Sparkles className="h-[15px] w-[15px]" />
      {visualState !== 'healthy' && (
        <span
          className={cn(
            'absolute -right-0.5 -top-0.5 h-4 min-w-4 rounded-full ring-2 ring-bg-primary',
            visualState === 'low' ? 'bg-amber-500' : 'bg-destructive',
          )}
          aria-hidden="true"
        />
      )}
    </Button>
  </PopoverTrigger>
  <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
    {/* header, balance, breakdown, low/zero note, Manage billing link */}
  </PopoverContent>
</Popover>
```
Note the dot badge (per UI-SPEC.md) has **no text content** — unlike `NotificationBell`'s numeric `badgeLabel`, this is `aria-hidden` with no visible label characters, since UI-SPEC.md specifies "a plain dot, not a count."

### Pattern 3: Server-Computed Boolean Passed as Prop (CRB-03 gating)
**What:** Resolve whether an org's plan includes credits entirely server-side in `(dashboard)/layout.tsx`, independent of the `isBillingEnforced()` gate, and pass a plain boolean down.
**When to use:** Any visibility gate that must work identically whether or not billing enforcement is flag-enabled.
**Example — recommended approach (uses the already-fetched balance row, avoids a second entitlements-shaped resolution):**
```typescript
// In (dashboard)/layout.tsx, alongside the existing entitlements resolution:
import { getCopilotBalance } from '@/lib/billing/credits'
import { resolveEffectivePlan } from '@/lib/billing/entitlements' // pure function, no IO — see Pitfall 1
import { getPlan } from '@/lib/billing/catalog'

// ... after activeOrgId is resolved ...
let copilotBalance = null
let hasCreditsPlan = false
if (activeOrgId) {
  try {
    const supabase = await createClient()
    const [{ data: org }, { data: subs }] = await Promise.all([
      supabase.from('organizations').select('trial_ends_at, plan_override').eq('id', activeOrgId).maybeSingle(),
      supabase.from('billing_subscriptions').select('status, stripe_price_id, created_at').order('created_at', { ascending: false }),
    ])
    const liveSub = subs?.find((s) => ['active', 'trialing', 'past_due'].includes(s.status)) ?? null
    const eff = resolveEffectivePlan({
      planOverride: org?.plan_override ?? null,
      subscription: liveSub ? { status: liveSub.status, stripePriceId: liveSub.stripe_price_id } : null,
      trialEndsAt: org?.trial_ends_at ?? null,
      now: new Date(),
    })
    const plan = getPlan(eff.planKey)
    copilotBalance = await getCopilotBalance(activeOrgId)
    hasCreditsPlan = (plan?.copilotIncludedUsd ?? 0) > 0 || copilotBalance.totalUsd > 0
  } catch {
    hasCreditsPlan = false
  }
}
```
This reuses the exact `resolveEffectivePlan()` pure function already used by `getEntitlements()` (see `src/lib/billing/entitlements.ts` lines 90-113) — it has zero IO, is separately unit-testable, and importing it does NOT pull in the `isBillingEnforced()` gate (that gate lives in the *caller*, `(dashboard)/layout.tsx`'s `entitlements` line, not inside `getEntitlements()` or `resolveEffectivePlan()` itself). This avoids computing the org/subscription resolution twice under two different names.

**Simpler fallback (if the above duplication is deemed unnecessary):** Since `copilot_credit_balances.included_allowance_usd` is set by `resetCopilotForPeriod()`/`ensureCopilotProvisioned()` to the plan's `copilotIncludedUsd` at provisioning time, checking `copilotBalance.includedAllowanceUsd > 0 || copilotBalance.totalUsd > 0` after the single `getCopilotBalance()` call is sufficient for CRB-03 in the common case — it avoids the second org/subscription query entirely. The edge case this misses: an org whose plan was JUST upgraded to a credit-bearing plan but hasn't been provisioned yet (no `copilot_credit_balances` row exists, `included_allowance_usd` reads as 0 via `EMPTY_BALANCE`) would incorrectly hide the indicator until the next provisioning/reset cycle runs. Decide based on how immediately CRB-03 must reflect a plan change — see Open Questions.

### Anti-Patterns to Avoid
- **Gating on `isBillingEnforced()` or `getEntitlements()`:** CONTEXT.md explicitly forbids this — the indicator's entire purpose is to be visible even while enforcement is off. Do not reuse `entitlements.copilotIncludedUsd` from the existing `(dashboard)/layout.tsx` `entitlements` variable, since that variable is `null` whenever `isBillingEnforced()` is false (which it is today, per `BILLING_ENFORCEMENT_ENABLED`).
- **Trusting `payload.new` field names to match `CopilotBalance`'s camelCase interface:** as shown in Pattern 1, the Realtime payload carries raw DB column names. Attempting `payload.new.includedUsd` will be `undefined`.
- **Re-deriving `toCredits()` instead of importing it:** CONTEXT.md's Claude's Discretion section prefers importing the existing helper from `credits-card.tsx`. It is not currently exported — see Pitfall 2.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| USD-to-credit rounding | A new `toCredits()` implementation in `credits-indicator.tsx` | Export `toCredits()` from `src/components/billing/credits-card.tsx` and import it (or hoist it to a shared, framework-agnostic location if the executor prefers not to introduce a cross-import between sibling billing components) | Avoids two divergent roundings of the same `CREDIT_USD_RATE` conversion; CONTEXT.md explicitly calls this out as "prefer importing the existing helper, not duplicating" |
| Plan-to-credit-allowance resolution | A parallel/duplicate plan resolver | `resolveEffectivePlan()` (pure, already unit-tested) + `getPlan()` from `catalog.ts` | Already exists, already tested (see `tests/billing-entitlements-unit.test.ts`), zero IO — reuse rather than reinvent |
| Realtime publication idempotency | A bespoke migration guard | The `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` wrapper from migration `024_chat_realtime_publication.sql` | This is the established, working idempotent pattern in this codebase for `ALTER PUBLICATION ... ADD TABLE`, used twice already (024, 1206) |

**Key insight:** Every piece this phase needs already exists somewhere in the codebase in a proven, working form (`NotificationBell` for the component shape, `resolveEffectivePlan` for plan resolution, migration 024/1206 for the publication grant). This phase is assembly, not invention — the planner should structure tasks as "port pattern X into new context Y," not "design a new mechanism for Z."

## Common Pitfalls

### Pitfall 1: Assuming `isBillingEnforced()` is baked into `getEntitlements()`/`resolveEffectivePlan()`
**What goes wrong:** A dev avoids calling `resolveEffectivePlan()` believing it's entangled with the enforcement flag, and instead invents a new resolution path.
**Why it happens:** The gate `isBillingEnforced() ? await getEntitlements() : null` lives in `(dashboard)/layout.tsx` (the caller), not inside `entitlements.ts`. `getEntitlements()` and `resolveEffectivePlan()` are always safe to call directly regardless of the flag.
**How to avoid:** Import `resolveEffectivePlan` and call it directly (or call `getEntitlements()` itself unconditionally for the new plan-check — its return shape already includes `copilotIncludedUsd`, at the cost of one more `getActiveOrg()` + org/subscription read). Either is safe; only the `isBillingEnforced()` conditional at the layout call-site controls enforcement UX, not data availability.
**Warning signs:** New code re-implementing plan-override/subscription/trial precedence logic instead of importing `resolveEffectivePlan`.

### Pitfall 2: `toCredits()` is not exported from `credits-card.tsx`
**What goes wrong:** `import { toCredits } from '@/components/billing/credits-card'` fails at compile time.
**Why it happens:** `credits-card.tsx` line 38 defines `function toCredits(usd: number): string` as a local, unexported function.
**How to avoid:** The plan must include a small task to add `export` to that function signature (a one-word change, no behavior change) before `credits-indicator.tsx` can import it. Confirmed by direct read of `src/components/billing/credits-card.tsx` line 38 — this is not currently exported.
**Warning signs:** TypeScript error `Module '"@/components/billing/credits-card"' has no exported member 'toCredits'`.

### Pitfall 3: Realtime payload shape mismatch
**What goes wrong:** Handler code written against the `CopilotBalance` camelCase interface silently reads `undefined` fields from the Realtime payload and renders a stale or zeroed balance after the first live update.
**Why it happens:** `postgres_changes` payloads always mirror raw Postgres column names (snake_case), regardless of any application-layer mapping function used elsewhere (like `getCopilotBalance`'s manual snake→camel mapping).
**How to avoid:** Write a small dedicated mapper (or inline destructure) in the Realtime handler that reads `included_balance_usd`, `topup_balance_usd`, `included_allowance_usd`, `period_end` — the exact column names from migration `1208_copilot_credits.sql` — not the `CopilotBalance` interface's field names.
**Warning signs:** Balance number goes to `NaN` or `0` immediately after any top-up/debit event fires, even though the initial server-rendered value was correct.

### Pitfall 4: Forgetting the migration means CRB-02 silently no-ops
**What goes wrong:** The component and layout changes ship, look correct in a manual click-through (initial balance renders fine), but the balance never updates live — because `copilot_credit_balances` was never added to the `supabase_realtime` publication.
**Why it happens:** A `.subscribe()` call on a table not in the publication does not throw or error visibly in the client — it just never receives events. There's no loud failure mode.
**How to avoid:** Treat the migration as a hard dependency for CRB-02, not an optional nice-to-have. Include a manual verification step in the plan: after `npx supabase db push`, trigger a `credit_copilot_credits`/`debit_copilot_credits` RPC call (or a manual `UPDATE` on the row) and confirm the open dashboard tab updates without reload.
**Warning signs:** No console errors, but balance never changes after a top-up in a live session.

### Pitfall 5: MobileMenu's invisible-overlay technique requires the tile's visible label to not eat pointer events
**What goes wrong:** Copying the `NotificationBell` mobile tile technique (`<div className="absolute inset-0 opacity-0"><CreditsIndicator .../></div>` layered over a visible icon+label) without also adding `pointer-events-none` to the visible icon/label spans (as the existing Notifications tile does) causes clicks to land on the wrong element or fail to open the popover.
**Why it happens:** The existing pattern (lines 151-157 of `top-bar.tsx`) explicitly adds `pointer-events-none` to both the `Bell` icon and its label `<span>` so all clicks pass through to the invisible overlay underneath.
**How to avoid:** Copy the full tile structure verbatim including `pointer-events-none` on the decorative icon/label, not just the overlay div.
**Warning signs:** Tapping the mobile "Credits" tile does nothing, or the tap target feels smaller than the visible tile.

## Code Examples

### Exact insertion point 1: `TopBar` desktop actions row
```typescript
// Source: src/components/layout/top-bar.tsx, lines 222-229 (current state)
{/* Desktop actions */}
<div className="hidden sm:flex items-center gap-1.5">
  <SearchButton onClick={openSearch} />
  {hasPhoneNumber && <DialPadHeaderButton />}
  <NotificationBell userId={userId} />
  <ThemeToggle />
  {/* INSERT HERE: <CreditsIndicator orgId={activeOrgId} initialBalance={copilotBalance} /> */}
  <div className="min-w-0">
    <OrgSwitcher currentOrgId={activeOrgId} currentOrgName={activeOrgName} currentOrgLogo={activeOrgLogo} />
  </div>
  {isPlatformAdmin && ( /* ... */ )}
</div>
```
CONTEXT.md says "between `ThemeToggle` and `OrgSwitcher`" — literally, insert directly after line 226 (`<ThemeToggle />`) and before line 227 (`<div className="min-w-0">`). This is unambiguous and matches UI-SPEC.md's note that this exact slot is acceptable. Render conditionally: `{hasCreditsPlan && <CreditsIndicator ... />}` (component itself may also self-guard by returning `null`, per UI-SPEC.md's Empty state row — CRB-03 says "component renders `null` entirely").

### Exact insertion point 2: `TopBar` component signature + prop threading
```typescript
// Source: src/components/layout/top-bar.tsx, lines 18-27 (current TopBarProps)
interface TopBarProps {
  activeOrgId: string | null
  activeOrgName: string | null
  activeOrgLogo?: string | null
  isPlatformAdmin: boolean
  userId: string | null
  hasPhoneNumber: boolean
  // ADD:
  // hasCreditsPlan: boolean
  // copilotBalance: CopilotBalance | null   // reuse the existing interface shape from src/lib/billing/credits.ts
}
```
`TopBar`'s destructured function signature (line 199) and the `MobileMenu` component's props (lines 56-73) both need the same two new props threaded through, since `MobileMenu` independently renders its own `<CreditsIndicator>` instance for its Quick Actions grid (mirroring how `userId` is already threaded to both for `NotificationBell`).

### Exact insertion point 3: `MobileMenu` Quick Actions grid
```typescript
// Source: src/components/layout/top-bar.tsx, lines 140-170 (current 3-tile grid)
<div className="grid grid-cols-3 gap-3">
  {/* Dial pad ... */}
  {/* Notifications — invisible overlay triggers the popover */}
  <div className="relative flex flex-col items-center justify-center gap-3 rounded-[14px] border border-border-subtle bg-bg-secondary px-3 py-6 hover:bg-bg-tertiary hover:border-border active:scale-95 transition-all duration-100 cursor-pointer">
    <Bell className="h-6 w-6 text-text-secondary pointer-events-none" />
    <span className="text-sm text-text-secondary pointer-events-none">Notifications</span>
    <div className="absolute inset-0 opacity-0">
      <NotificationBell userId={userId} />
    </div>
  </div>
  {/* Theme ... */}
  {/* INSERT 4th tile HERE (after Theme, or per UI-SPEC.md, exact grid position is discretionary) — same overlay technique, using Sparkles icon and pointer-events-none on both icon+label */}
</div>
```
UI-SPEC.md explicitly defaults to option (a): keep `grid-cols-3` and let the 4th tile wrap to a new row — no grid column count change. Import `Sparkles` from `lucide-react` in `top-bar.tsx` (currently imported icons on line 6 do not include `Sparkles`).

### Exact insertion point 4: `(dashboard)/layout.tsx` — new data fetch + prop pass-through
```typescript
// Source: src/app/(dashboard)/layout.tsx, line 72 (existing entitlements line, for context — do not modify)
const entitlements = isBillingEnforced() ? await getEntitlements() : null
// NEW, added alongside (not replacing) the above, anywhere after activeOrgId is resolved (line 46):
// const { copilotBalance, hasCreditsPlan } = await resolveCreditsVisibility(activeOrgId)
```
```typescript
// Source: src/app/(dashboard)/layout.tsx, lines 215-222 (current <TopBar .../> call site)
<TopBar
  activeOrgId={activeOrgId}
  activeOrgName={activeOrgName}
  activeOrgLogo={branding.logoUrl}
  isPlatformAdmin={isPlatformAdmin}
  userId={user.id}
  hasPhoneNumber={hasPhoneNumber}
  // ADD: hasCreditsPlan={hasCreditsPlan}
  // ADD: copilotBalance={copilotBalance}
/>
```
Recommend extracting the resolution logic (Pattern 3 above) into a small helper — e.g. a new exported function in `src/lib/billing/credits.ts` such as `resolveCreditsVisibility(orgId)` returning `{ balance: CopilotBalance, hasCreditsPlan: boolean }` — rather than inlining ~15 lines directly in the already-large `(dashboard)/layout.tsx`. This keeps the layout diff small and makes the gating logic independently testable (pure-ish, single IO boundary).

### New migration: `1226_copilot_credits_realtime.sql`
```sql
-- Source pattern: supabase/migrations/024_chat_realtime_publication.sql (verbatim structure)
-- Migration 1226: Enable Realtime for the Copilot credit balance indicator
-- Adds copilot_credit_balances to the supabase_realtime publication so the
-- TopBar CreditsIndicator can subscribe via postgres_changes and reflect
-- balance changes (debits, top-ups, monthly resets) live, without a page
-- reload (CRB-02). Idempotent: wraps the ALTER in a DO block that swallows
-- duplicate_object errors, matching migrations 024 and 1206.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_credit_balances;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```
Next sequential migration number confirmed as **1226** — highest existing file in `supabase/migrations/` is `1225_metering_reason.sql`; no `1226_*` file exists yet.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A | N/A | N/A | This is a small, self-contained feature phase inside a mature, already-decided codebase — there is no "old vs new" ecosystem shift to track. All patterns referenced (Realtime, Popover, shadcn) are the codebase's current, singular convention. |

No deprecated/outdated approaches apply here — everything in scope reuses existing, actively-maintained in-repo patterns.

## Runtime State Inventory

Not applicable — this is a greenfield UI addition (new component + additive prop threading + additive migration), not a rename/refactor/migration phase. No existing strings, IDs, or stored data are being renamed or moved.

## Open Questions

1. **Should CRB-03's plan-includes-credits check use the full `resolveEffectivePlan()` re-resolution, or the simpler `copilotBalance.includedAllowanceUsd > 0` fallback?**
   - What we know: Both approaches are described in Pattern 3 above. The full resolution is more "correct" in the edge case of a just-upgraded, not-yet-provisioned org; the simpler fallback avoids a second org/subscription DB read per page load (this runs on every dashboard page render).
   - What's unclear: Whether that edge case (plan upgraded but wallet not yet provisioned) is reachable in practice — `ensureCopilotProvisioned()` is called from the Copilot request path, so a genuinely new-to-credits org might not have a `copilot_credit_balances` row until their first Copilot turn, in which case BOTH approaches would need `getPlan(planKey).copilotIncludedUsd` (not just the balance row) to show the indicator pre-first-use.
   - Recommendation: Use the full `resolveEffectivePlan()` approach (Pattern 3, primary example) — it correctly handles the pre-provisioning case, and the added DB read is two `maybeSingle()`/indexed queries already proven cheap enough to run on every settings/billing page load today. This is a per-request React `cache()`-friendly read if wrapped similarly to `getEntitlements()` (the existing `cache()` wrapper import), which the planner should consider replicating for the new resolution to avoid double-fetching if it's called from multiple places in the same request.

2. **Should the new plan-resolution + balance fetch be wrapped in React's `cache()` like `getEntitlements()` is?**
   - What we know: `getEntitlements()` uses `cache()` from `react` (line 14, 120 of `entitlements.ts`) specifically so the layout, sidebar, and pages can share one resolution per request.
   - What's unclear: Whether anything else in this phase's scope calls the new resolution more than once per request — currently only `(dashboard)/layout.tsx` needs it.
   - Recommendation: Not strictly necessary for this phase (single call site), but cheap insurance if the planner extracts the logic into `src/lib/billing/credits.ts` as a reusable export — wrapping in `cache()` costs nothing and future-proofs against a second call site (e.g., a future settings page needing the same boolean).

3. **Exact placement of the new migration number if a competing PR lands 1226 first.**
   - What we know: 1225 is confirmed as the current highest migration.
   - What's unclear: Whether another in-flight branch (e.g., Phase 116/117 work) might also claim 1226 before this phase merges.
   - Recommendation: Re-verify the highest migration number immediately before creating the file at execution time (`ls supabase/migrations | tail -5`), not just at planning time — this is a fast, cheap check worth re-running per the project's own migration convention (never edit old ones, always take the next free number).

## Environment Availability

Not applicable — this phase has no new external dependencies. Supabase Realtime, the existing Postgres database, and all npm packages used are already installed and configured in the project (confirmed via `package.json` reads above). No new CLI tools, services, or runtimes are introduced.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 |
| Config file | `vitest.config.ts` (environment: `'node'`, globals: true, `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']`) |
| Quick run command | `npx vitest run tests/billing-credits-indicator.test.ts` (new file, see Wave 0 Gaps) |
| Full suite command | `npx vitest run` |

**Important finding:** This repo has **no component-rendering test infrastructure** — no `@testing-library/react`, no `@testing-library/jest-dom`, and `vitest.config.ts` runs with `environment: 'node'` (not `jsdom`), even though `jsdom`/`@types/jsdom` are present as transitive/unused deps in `package.json`. Confirmed via direct grep of `package.json` and `vitest.config.ts`. This means **no existing precedent renders a React component in a test** — the established pattern instead is to export pure helper functions from `'use client'` component files and unit-test those directly (see `getBadgeLabel` in `notification-bell.tsx`, tested by `tests/notifications/unread-count.test.ts` with zero rendering).

This phase should follow that exact precedent: extract the CRB-04 visual-state threshold logic (healthy/low/zero, the 20% rule from UI-SPEC.md) into an exported pure function (e.g., `getCreditsVisualState(totalUsd, includedAllowanceUsd): 'healthy' | 'low' | 'zero'`) inside `credits-indicator.tsx`, and unit-test that function directly — mirroring `getBadgeLabel`. Full component interaction (Popover open/close, Realtime event handling) is **not automatable today** without adding `@testing-library/react` + `jsdom` environment config, which is out of scope for this UI-only phase (per the phase description: "BTC-01..04 automated coverage is a Phase 116 concern"). Manual click-through verification is the appropriate substitute for the interactive/visual parts.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRB-01 | Indicator renders with included+topup breakdown when plan has credits | manual-only (server-rendered dashboard page, requires visual/DOM assertion this repo can't yet automate) | — | N/A — no component render harness exists |
| CRB-02 | Balance updates live via Realtime without reload | manual-only (requires a live Supabase connection + browser session — not unit-testable) | — | N/A |
| CRB-03 | Indicator hidden for orgs without a credit-bearing plan | unit (pure logic) — the plan-includes-credits boolean resolution, if extracted as a pure/testable function | `npx vitest run tests/billing-credits-visibility.test.ts` | ❌ Wave 0 |
| CRB-04 | 3-state visual threshold (healthy/low/zero) + click-through link | unit (pure logic) for the threshold function; manual for the click-through/link rendering | `npx vitest run tests/billing-credits-indicator.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/billing-credits-indicator.test.ts tests/billing-credits-visibility.test.ts` (fast, pure-logic only)
- **Per wave merge:** `npx vitest run` (full suite — confirms no regression to `tests/billing-entitlements-unit.test.ts` or `tests/notifications/*` from the shared-pattern reuse)
- **Phase gate:** Full suite green before `/gsd:verify-work`; manual click-through required for CRB-01, CRB-02, CRB-04's visual/interactive aspects since no component-render harness exists in this repo (document this explicitly as a known, accepted gap — not a phase blocker, consistent with how `notification-bell.tsx`'s Popover/Realtime behavior itself has never been component-tested here either)

### Wave 0 Gaps
- [ ] `tests/billing-credits-visibility.test.ts` — unit tests for the plan-includes-credits boolean resolution (CRB-03), following the `resolveEffectivePlan()` pure-function test style already in `tests/billing-entitlements-unit.test.ts`
- [ ] `tests/billing-credits-indicator.test.ts` — unit tests for the exported `getCreditsVisualState()` threshold function (CRB-04: healthy/low/zero at the 20% boundary and its edges: exactly 0, exactly 20%, just above/below)
- [ ] No framework install needed — Vitest is already configured and sufficient for the pure-logic tests this phase can produce

## Sources

### Primary (HIGH confidence — direct file reads of this codebase)
- `src/components/layout/top-bar.tsx` — full current content, exact JSX line numbers for insertion points
- `src/app/(dashboard)/layout.tsx` — full current content, exact `entitlements`/`activeOrgId`/`<TopBar>` computation and render lines
- `src/components/notifications/notification-bell.tsx` — full content, the direct structural template (Popover, Realtime channel, badge)
- `src/components/notifications/notification-list.tsx` — popover content layout precedent
- `src/lib/billing/credits.ts` — full content, confirms `getCopilotBalance()` shape and service-role read (no RLS/enforcement dependency)
- `src/lib/billing/entitlements.ts` — full content, confirms `resolveEffectivePlan()` is a pure function decoupled from `isBillingEnforced()`
- `src/lib/billing/catalog.ts` — full content, confirms `PLAN_CATALOG[key].copilotIncludedUsd` values (Starter 5, Pro 20, Enterprise 100)
- `src/lib/billing/config.ts` — confirms `isBillingEnforced()` is the sole gate, lives outside `entitlements.ts`
- `src/components/billing/credits-card.tsx` — full content, confirms `toCredits()` is NOT currently exported (Pitfall 2)
- `src/components/billing/plan-usage-card.tsx` — confirms the `amber-500`/`bg-accent` visual precedent UI-SPEC.md references
- `src/app/(dashboard)/settings/billing/page.tsx` — confirms existing `getCopilotBalance(ctx.orgId)` call site and its parallel-fetch pattern
- `supabase/migrations/1208_copilot_credits.sql` — confirms `org_id uuid PRIMARY KEY` on `copilot_credit_balances` (valid Realtime filter target)
- `supabase/migrations/1225_metering_reason.sql` — confirms 1225 is the current highest migration number
- `supabase/migrations/024_chat_realtime_publication.sql` — exact idempotent `ALTER PUBLICATION` syntax to copy
- `supabase/migrations/1206_call_logs_realtime.sql` — second precedent confirming the same idempotent pattern is the established convention (used twice already)
- `vitest.config.ts` — confirms `environment: 'node'`, no jsdom, test file locations
- `tests/notifications/unread-count.test.ts` — confirms the pure-function-export testing precedent (`getBadgeLabel`)
- `package.json` — confirms no `@testing-library/react` dependency; confirms installed versions of `next`, `react`, `@supabase/*`
- Directory listing of `supabase/migrations/` (via `ls`) — confirms no `.test.tsx`/`.spec.tsx` files exist anywhere in `src/`
- `.planning/config.json` — confirms `workflow.nyquist_validation: true` (Validation Architecture section required)

### Secondary (MEDIUM confidence)
None used — all findings were verifiable by direct file inspection of this repository, no external/web sources were needed for this phase's scope.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all versions read directly from `package.json`
- Architecture: HIGH — every pattern is a direct read of an existing, working file in this repo (`NotificationBell`, `entitlements.ts`, migration precedents)
- Pitfalls: HIGH — each pitfall was discovered by direct code inspection (unexported `toCredits`, snake_case Realtime payloads, publication-not-enabled), not speculation

**Research date:** 2026-07-01
**Valid until:** 30 days (stable, internal-codebase-only research; no external ecosystem drift risk since no third-party libraries are being newly introduced)

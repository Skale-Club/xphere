# Phase 115: Credit Balance Visibility - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can see their org's credit balance at a glance from anywhere in the dashboard, with it staying current and guiding them toward billing when it matters. A persistent indicator lives in the global `TopBar`, gated by whether the org's plan includes credits (not by the `BILLING_ENFORCEMENT_ENABLED` operational flag), and updates live via Supabase Realtime without a page reload.

</domain>

<decisions>
## Implementation Decisions

### Layout & Visual Design
- Indicator placed in `TopBar` (`src/components/layout/top-bar.tsx`) between `ThemeToggle` and `OrgSwitcher`, following the existing `NotificationBell` visual pattern (`Button variant="ghost" size="icon-sm"`)
- Display format: icon (`Sparkles`, already used in `CreditsCard`) + rounded credit count via the existing `toCredits()` conversion; hidden on mobile via the same `hidden sm:flex` wrapper used for other desktop-only TopBar actions
- Click opens a `Popover` (matching `NotificationBell`'s `Popover`/`PopoverContent` pattern) showing included/topup breakdown plus a "Manage billing" link to `/settings/billing` — not a direct navigation
- Mobile: added to the `MobileMenu` Quick Actions grid (alongside Dial pad / Notifications / Theme), matching that 3-icon grid pattern

### Visibility Gating
- Gated on the org's resolved plan (`copilotIncludedUsd > 0` from `PLAN_CATALOG`, or an existing non-empty `copilot_credit_balances` row), NOT on `isBillingEnforced()` — the indicator must be visible today even though enforcement is currently off, since that's the entire point of this phase
- `getCopilotBalance(activeOrgId)` is fetched directly in `(dashboard)/layout.tsx` (a plain balance-table read, no dependency on the existing `isBillingEnforced()`-gated `getEntitlements()` call) and passed down as a prop through `TopBar`
- Hide only when the org has no billing relationship at all (no plan resolves to a nonzero `copilotIncludedUsd` and no existing balance row) — do not hide simply because enforcement is off

### Live Update Mechanism
- Supabase Realtime subscription on `copilot_credit_balances`, scoped to the org's row, following the exact channel-subscribe/cleanup pattern already established in `NotificationBell` (`supabase.channel(...)`, `.on('postgres_changes', ...)`, cleanup on unmount)
- `copilot_credit_balances` does NOT currently have Realtime publication enabled — a new migration is required in this phase (`ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_credit_balances`, following the precedent of migration 024 for `conversations`/`conversation_messages`)
- No special-casing for the top-up checkout redirect — Realtime will naturally pick up the Stripe webhook's balance update; `CreditsCard`'s existing `topupResult` toast logic on `/settings/billing` is untouched
- Balance number updates instantly on Realtime event, no pulse/highlight animation (Claude's discretion, kept simple)

### Claude's Discretion
- Exact Popover width/spacing details, matching existing `w-80` sizing used by `NotificationBell`'s popover content
- Whether to reuse `CreditsCard`'s `toCredits()` import directly or re-export it — prefer importing the existing helper, not duplicating

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/notifications/notification-bell.tsx` — the direct template to follow: `Popover`/`PopoverContent` trigger pattern, Supabase Realtime channel subscribe/cleanup, badge overlay styling
- `src/components/billing/credits-card.tsx` — `toCredits()` USD-to-credit rounding helper, `KIND_LABEL` ledger kind labels, existing `CREDIT_USD_RATE` import from `@/lib/billing/catalog`
- `src/lib/billing/credits.ts` `getCopilotBalance(orgId)` — already returns `{ includedUsd, topupUsd, totalUsd, includedAllowanceUsd, periodEnd }`, no changes needed to this function itself
- `src/lib/billing/catalog.ts` `PLAN_CATALOG` — has `copilotIncludedUsd` per plan (Starter 5, Pro 20, Enterprise 100) to resolve "does this org's plan include credits"

### Established Patterns
- `TopBar` (`src/components/layout/top-bar.tsx`) is the single global header rendered once in `(dashboard)/layout.tsx` (line ~215) for every dashboard page — already receives `activeOrgId`, `isPlatformAdmin`, `userId` etc. as server-computed props
- `(dashboard)/layout.tsx` already resolves `entitlements` (only when `isBillingEnforced()`), `isOrgAdmin`, `activeOrgId` — the new balance fetch should sit alongside these, not replace or gate on the existing `entitlements` computation
- Realtime channel pattern: `supabase.channel(`name:${id}`)`, `.on('postgres_changes', { event, schema: 'public', table, filter }, handler)`, `.subscribe()`, cleanup via `supabase.removeChannel(channel)` in the effect's return

### Integration Points
- `(dashboard)/layout.tsx` — add `getCopilotBalance(activeOrgId)` call, pass result + plan-includes-credits boolean as new `TopBar` props
- `TopBar` component — render new `CreditsIndicator` (or similar name) between `ThemeToggle` and `OrgSwitcher` in both the desktop actions row and `MobileMenu`'s quick actions grid
- New migration (next sequential number after 1225) to enable Realtime publication on `copilot_credit_balances`

</code_context>

<specifics>
## Specific Ideas

No additional specific requests beyond what's captured above — the three grey areas (layout, visibility gating, live updates) cover the full CRB-01..04 surface.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Low-balance alert/blocking UX beyond the indicator's own visual state change is explicitly deferred (see REQUIREMENTS.md v2 MET-08).

</deferred>

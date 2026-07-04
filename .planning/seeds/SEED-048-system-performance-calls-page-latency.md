---
id: SEED-048
status: dormant
planted: 2026-07-04
planted_during: post-v3.3 (Settings Nav Cleanup + Unified Templates) — no milestone in progress; ad-hoc performance audit requested by operator after reports of slow click-to-render across the dashboard, most visible on the Calls page
trigger_when: any milestone or quick task that touches the Calls page, the dashboard root layout, the Action Engine's activity feed, or is explicitly scoped as "performance" / "otimização" / "velocidade"; or the next time a user reports "demora para carregar" / "trava ao clicar" on any dashboard page
scope: Large
depends_on: []
---

# SEED-048: System Performance — Click-to-Render Latency (Calls Page + Dashboard-Wide)

## Why This Matters

The operator reported that clicking to navigate feels slow across the system, "principalmente na página de Calls" (most noticeable on Calls). A full audit (2026-07-04) covering the calls feature, the dashboard root layout, Supabase query patterns, client bundle composition, and realtime/polling behavior found that **this isn't one bug — it's five compounding categories of waste that all land on every click**:

1. **The Calls detail dialog re-fetches data it already has.** Clicking a call in the list triggers `getUnifiedCall(id)` (data already present in the list rows), then `CallDetailAi`/`CallDetailHuman` re-fetch the *same row* from `calls`/`call_logs` with `select('*')`, then — sequentially, only after that resolves — fetch `action_logs`. That's 2-3 serialized round-trips of largely redundant data before the dialog can render anything.
2. **The Calls page always ships ~280KB of JS it doesn't need yet.** The Twilio Voice SDK (~200KB) and wavesurfer.js (~80KB) are imported at module top-level in components that are always part of the calls page's client bundle, regardless of whether the user opens the detail dialog, uses browser-mode calling, or even has voice calling configured. Same pattern for `VoiceSettingsDialog`/`RoutingChainEditor` (~150-200KB) — bundled even when Settings is never opened.
3. **Every single page navigation pays avoidable dashboard-layout overhead.** The root `(dashboard)/layout.tsx` runs a sequential (non-parallelized) `call_routing_chains` query after its `Promise.all` batch, `getRbacContext()` runs 3 sequential queries that don't depend on each other, and `getOrgSettings()`/`getActiveOrg()` independently re-derive overlapping org data. This tax applies to literally every click in the app, which is likely why the slowness "feels" system-wide and not calls-specific.
4. **Other high-traffic pages have the same N+1/sequential-fetch shape.** The dashboard activity feed runs 4 independent queries in sequence instead of `Promise.all`; the campaigns list fetches *all* `campaign_contacts` rows and filters them in JavaScript instead of aggregating in SQL; company/account detail chains 3 sequential queries (contacts → opportunities → activities) where one JOIN or RPC would do.
5. **A few realtime/polling patterns are actively wasteful.** Most realtime subscriptions in the app are well-scoped and cleaned up correctly (no action needed there), but the Knowledge Manager admin page polls with a full `router.refresh()` every 5 seconds (re-fetches and re-renders the entire layout), and the Evolution WhatsApp QR setup flow polls every 8 seconds with no stop condition once connected.

None of these are single silver-bullet fixes — the "perfect" outcome the operator asked for requires working through all five categories. Phases are ordered by user-visible impact: Calls-specific data-fetching first (matches the exact complaint), then Calls bundle size, then the dashboard-wide layout tax (explains the "slow everywhere" perception), then the same patterns found on other pages, then query/index hygiene, then realtime/polling cleanup.

## What Needs to Change

### Phase A — Calls Detail: Kill the Duplicate-Fetch Waterfall

**Goal:** Clicking a call in the list renders the detail dialog from data that's already loaded, with zero redundant round-trips.

- `src/app/(dashboard)/calls/(hub)/page.tsx:110,123-124` — `CallDetail({ id })` calls `getUnifiedCall(id)` again even though the clicked row's data is already present in the hub's `rows` prop passed to `UnifiedCallTimeline`. Thread the already-fetched row through (via a client-side lookup keyed by id, or pass it through the URL-driven dialog state) instead of re-querying.
- `src/components/calls/call-detail-ai.tsx:15-40` — re-fetches the `calls` row with `.select('*')` (line ~21) that `getUnifiedCall` already returned, then *sequentially* fetches `action_logs` only after that resolves (lines 26-32) because it depends on `vapiCall.vapi_call_id`. Restructure so both the row data reuse and the `action_logs` fetch either (a) come from a single server function that does one narrowed-column query plus one `action_logs` query in parallel where possible, or (b) reuse `vapi_call_id` if it's already available from the unified row instead of re-deriving it.
- `src/components/calls/call-detail-human.tsx:16-24` — same shape: re-fetches `call_logs` with `select('*')` for fields (`ended_at`, `call_sid`, `recording_duration`) that could be included in the unified row selection instead.
- `src/app/(dashboard)/calls/actions.ts:94-115` (`getUnifiedCall`) and the `unified_calls` view consumers — narrow `select('*')` to the columns each view actually renders; stop pulling full `transcript_turns`/transcript text into the list-adjacent detail fetch when the transcript tab isn't the one open.
- `src/components/calls/call-detail-dialog.tsx:13-32` — the `close()` callback and dialog re-render depend on the full `searchParams` object, so unrelated query-string changes (e.g. a timeline filter) can trigger unnecessary re-renders of the dialog subtree. Narrow the dependency to just the `call` param.
- `src/components/calls/unified-call-timeline.tsx:170-186` — `UnifiedCallRow` has no `React.memo`; every row re-renders on any parent state change (dialog open/close, filter click). Add memoization keyed on row id/updated_at.
- `src/app/(dashboard)/calls/loading.tsx` — only covers the timeline skeleton; there's no loading state for the detail dialog's content while `CallDetailAi`/`CallDetailHuman` resolve, so the dialog opens instantly but shows nothing/stale content until the fetch(es) land. Add a skeleton for the dialog body.

### Phase B — Calls Page: Code-Split the Heavy Client Bundles

**Goal:** The Calls page's initial JS payload only includes what's needed for the list view; voice-calling and settings code loads on demand.

- `src/components/calls/twilio-device-provider.tsx:17,73-139` — `@twilio/voice-sdk` (~200KB) is imported at module top-level in a component that's always mounted in the dashboard layout (`src/app/(dashboard)/layout.tsx:217`, gated by `browserVoiceEnabled`/`routing_mode==='browser'` at *runtime*, but not code-split, so the SDK still ships in the JS bundle for every user regardless of routing mode). Wrap with `next/dynamic(() => import(...), { ssr: false })` so users on `phone_forward`/`sip` modes never download it.
- `src/components/calls/call-waveform-player.tsx:5` — `wavesurfer.js` (~80KB) imported eagerly; only used inside the detail dialog's audio tab. Dynamic-import it so it's not part of the calls page's initial bundle.
- `src/app/(dashboard)/calls/(hub)/page.tsx` — `CallDetailDialog`, `VoiceSettingsDialog` (and its child `RoutingChainEditor`, ~437 LOC / ~150KB with its own form deps) are imported directly instead of via `next/dynamic`, so their full trees ship even when `?call=` / `?settings=` aren't present in the URL. Convert both to dynamic imports gated on the corresponding search param being present.
- Cross-reference with **Phase D of SEED-047** (workflow runtime) if still pending: `src/components/flows/flow-canvas.tsx` + `node-config-panel.tsx` (~2000 LOC, `@xyflow/react` ~100KB) have the identical always-bundled-never-split shape on the Workflows pages. Worth fixing in the same pass since the technique (route-gated `next/dynamic`) is identical.

### Phase C — Dashboard Layout & Auth: Parallelize the Per-Navigation Tax

**Goal:** Every page navigation resolves auth/org/RBAC context in one parallel batch instead of a chain of sequential round-trips, since this overhead is paid on literally every click in the app.

- `src/app/(dashboard)/layout.tsx:139-156` — the `call_routing_chains` query runs *after* and separately from the `Promise.all` batch at line 121; fold it into that same parallel batch.
- `src/app/(dashboard)/layout.tsx:208` vs `getActiveOrg()` (~line 46) — `getOrgSettings()` independently re-resolves `get_current_org_id()` and re-fetches the `organizations` row that `getActiveOrg()` already fetched moments earlier. Consolidate into one cached helper that both call, or have `getOrgSettings()` accept the already-resolved org id/row.
- `src/lib/rbac/server.ts:28-50` — `getRbacContext()` runs `get_current_org_id()` RPC → `platform_admins` lookup → `org_members` lookup sequentially even though the platform-admin check doesn't depend on the org-membership result. Parallelize with `Promise.all` where there's no real data dependency.
- `src/hooks/use-unread-count.ts:25-52` — client component fetches the unread count fresh on every mount instead of receiving a server-computed initial value as a prop; the realtime subscription is fine, but the initial paint always waits on a client round-trip.
- `src/components/layout/org-switcher.tsx:141-151` — org list is fetched lazily on first dropdown open (`getUserOrgs()`), so the *first* interaction with the switcher stalls; preload it server-side in the layout and pass down.
- `src/components/notifications/notification-bell.tsx:75` — fetches notifications client-side on every mount (every page nav); consider passing an initial server-fetched page similarly.

### Phase D — System-Wide Query Waterfalls & N+1 (Beyond Calls)

**Goal:** The same sequential-fetch and N+1 shapes found in Calls don't also exist on the other highest-traffic pages.

- `src/app/(dashboard)/actions.ts:23-181` (dashboard activity feed) — 4 independent queries (`conversation_messages`, `call_logs`, `opportunity_activities`, `google_reviews`) run sequentially inside separate `if` blocks instead of `Promise.all`.
- `src/app/(dashboard)/campaigns/actions.ts:277-300` — fetches **all** `campaign_contacts` rows (unbounded, no `.limit()`) across every campaign in the org and filters them in JavaScript per campaign (O(campaigns × contacts)) instead of a single grouped/aggregated SQL query.
- `src/app/(dashboard)/companies/[id]/actions.ts:67-119` — three-stage sequential chain: fetch linked `contacts` → derive `contactIds` → fetch `opportunities` → derive `oppIds` → fetch `opportunity_activities`. Collapse into a single RPC/JOIN or at minimum parallelize the parts that don't actually depend on each other.
- `src/lib/pipeline/actions.ts` (multiple: `moveOpportunity`, `updateStage`, etc.) and similar action files — `get_current_org_id()` is invoked repeatedly within a single server action instead of resolved once and threaded through.

### Phase E — Query Narrowing & Indexes

**Goal:** Hot-path queries fetch only the columns they render and hit an index instead of a sequential scan.

- `src/app/(dashboard)/contacts/actions.ts:1563` (`exportContactsCsv`) — `select('*')` with a hard `.limit(5000)` that silently truncates larger orgs' exports; needs real pagination/streaming, not a bigger limit.
- `src/app/(dashboard)/contacts/actions.ts:144-157` (`identityContactIds`) — filters `contact_channel_identities` by `provider` with no supporting index; add `(provider, contact_id)`.
- `supabase/migrations/015_conversations.sql` — `conversation_messages` has separate `org_id` and `created_at` indexes but queries filter+sort by both; a composite `(org_id, created_at DESC)` avoids a sort step.
- `supabase/migrations/053_call_system.sql` — `idx_call_logs_org_date (org_id, started_at DESC)` doesn't cover the common `status`/`direction` filters used in `src/app/(dashboard)/calls/actions.ts:54-70`; evaluate a composite that includes the most-filtered column.
- Calls list/detail `select('*')` usages (Phase A above already covers the detail-view instances) — apply the same column-narrowing discipline to any remaining list-view queries that pull transcript/summary text unnecessarily.

### Phase F — Realtime & Polling Cleanup

**Goal:** No component polls more aggressively than it needs to, and nothing does a full-page refresh on a timer.

- `src/components/admin/global-knowledge/knowledge-manager.tsx:137-144` — `setInterval(() => router.refresh(), 5_000)` triggers a full server round-trip + full layout re-render every 5s while a Notion sync is active. Replace with a Supabase realtime subscription on the sync-jobs table (same pattern already used correctly elsewhere in the app, e.g. `contact-status-board.tsx`).
- `src/components/integrations/evolution-setup-flow.tsx:373-380` — 8-second QR-code poll has no condition to stop once the connection succeeds; add a status check that clears the interval on `connected`/terminal states.
- `src/components/calls/incoming-call-banner.tsx:24-37` — fetches `/api/voice/contact-by-phone` fresh on every incoming call with no caching; add a short-TTL in-memory cache keyed by phone number.

### Phase G (Optional) — Build Tooling & Bundle Visibility

**Goal:** Future regressions are caught before they ship, not discovered via user complaints.

- `next.config.ts` — add `experimental.optimizePackageImports` for `lucide-react`/`@phosphor-icons/react` and any other large tree-shakeable-in-theory package.
- `package.json` build script currently runs `next build --webpack` (explicit fallback away from Turbopack's bundler) — investigate whether this was a deliberate workaround (check git blame/history) or can be lifted now that Turbopack build has matured, since Turbopack tree-shakes icon libraries more aggressively.
- No `@next/bundle-analyzer` (or equivalent) is wired into the build — add one so bundle-size regressions on pages like Calls/Workflows are visible in CI or local builds, not just discovered via audits like this one.

## When to Surface

**Trigger:** Any milestone or quick task scoped to the Calls page, the dashboard root layout, or explicitly labeled "performance" / "otimização" / "velocidade" — or the next time a user reports slow clicks/navigation anywhere in the dashboard.

This seed should be presented during `/gsd:new-milestone` when:
- Milestone scope includes "performance", "otimização", "velocidade", "latência", "calls page", or "dashboard layout"
- Milestone scope is a continuation of the in-progress `v3.5 Calls overhaul` (`.planning/v35-calls-overhaul/SPEC.md`) — Phase A/B above should be sequenced alongside that work since they touch the same files (`call-detail-dialog.tsx`, `unified-call-timeline.tsx`, `voice-settings-tabs.ts`) that overhaul is actively modifying
- A milestone is framed as "tech debt" / "stability" / "infrastructure hardening" cleanup, similar to how SEED-047 was prioritized after v2.9

**Strong recommendation:** Phase A (Calls detail waterfall) and Phase C (dashboard layout parallelization) are the highest-leverage, lowest-risk fixes — pure `Promise.all`/reuse-existing-data refactors with no schema or behavior changes — and could reasonably be pulled out as a standalone quick task before or independent of a full milestone, since they directly address the operator's exact complaint.

## Scope Estimate

**Large** — 6 required phases + 1 optional, estimated 2-3 weeks of focused work:
- Phase A (Calls detail waterfall): ~3 days
- Phase B (Calls bundle splitting): ~2 days
- Phase C (Dashboard layout parallelization): ~2 days
- Phase D (System-wide N+1/waterfalls): ~3 days
- Phase E (Query narrowing & indexes): ~2 days
- Phase F (Realtime/polling cleanup): ~1 day
- Phase G (Build tooling, optional): ~1 day

Phases A and C can ship independently and fastest — recommend starting there if the goal is to address the reported slowness with minimal risk before committing to the full scope.

## Breadcrumbs

### Phase A — Calls detail waterfall
- `src/app/(dashboard)/calls/(hub)/page.tsx:110,123-124` — `CallDetail({ id })` re-fetches via `getUnifiedCall`
- `src/app/(dashboard)/calls/actions.ts:94-115` — `getUnifiedCall()`
- `src/components/calls/call-detail-ai.tsx:15-40` — sequential `calls` + `action_logs` fetch, both `select('*')`
- `src/components/calls/call-detail-human.tsx:16-24` — `call_logs` re-fetch, `select('*')`
- `src/components/calls/call-detail-dialog.tsx:13-32` — re-render on unrelated searchParams
- `src/components/calls/unified-call-timeline.tsx:170-186` — `UnifiedCallRow` not memoized
- `src/app/(dashboard)/calls/loading.tsx` — no dialog-body loading state

### Phase B — Calls bundle splitting
- `src/components/calls/twilio-device-provider.tsx:17,73-139` — `@twilio/voice-sdk` always bundled
- `src/components/calls/call-waveform-player.tsx:5` — `wavesurfer.js` always bundled
- `src/app/(dashboard)/calls/(hub)/page.tsx` — `CallDetailDialog`/`VoiceSettingsDialog` not dynamically imported
- `src/components/calls/routing-chain-editor.tsx` (437 LOC) — bundled with page even when settings closed
- `src/app/(dashboard)/layout.tsx:217` — `VoiceDeviceShell`/`TwilioDeviceProvider` mount point, `browserVoiceEnabled` runtime gate (not a code-split gate)
- For later cross-reference: `src/components/flows/flow-canvas.tsx`, `src/components/flows/node-config-panel.tsx` — same pattern, `@xyflow/react`

### Phase C — Dashboard layout & auth parallelization
- `src/app/(dashboard)/layout.tsx:121` (`Promise.all` batch), `:139-156` (sequential `call_routing_chains`), `:174,208` (`getOrgSettings`/duplicate `createClient`)
- `src/lib/rbac/server.ts:28-50` — `getRbacContext()` sequential RPC + 2 selects
- `src/hooks/use-unread-count.ts:25-52` — client fetch on mount
- `src/components/layout/org-switcher.tsx:141-151` — lazy org list fetch on dropdown open
- `src/components/notifications/notification-bell.tsx:75` — client fetch on mount
- `src/components/billing/credits-indicator.tsx:29-67` — layout-level realtime (by design, noted for awareness not necessarily a fix)

### Phase D — System-wide N+1/waterfalls
- `src/app/(dashboard)/actions.ts:23-181` — dashboard activity feed, 4 sequential queries
- `src/app/(dashboard)/campaigns/actions.ts:277-300` — unbounded `campaign_contacts` fetch + client-side filter
- `src/app/(dashboard)/companies/[id]/actions.ts:67-119` — 3-stage sequential contact→opportunity→activity chain
- `src/lib/pipeline/actions.ts` — repeated `get_current_org_id()` calls per action

### Phase E — Query narrowing & indexes
- `src/app/(dashboard)/contacts/actions.ts:1563` — `exportContactsCsv`, `select('*')` + hard `.limit(5000)`
- `src/app/(dashboard)/contacts/actions.ts:144-157` — `identityContactIds`, no index on `provider`
- `supabase/migrations/015_conversations.sql` — `conversation_messages` indexes not composite
- `supabase/migrations/053_call_system.sql` — `idx_call_logs_org_date` doesn't cover `status`/`direction` filters
- `src/app/(dashboard)/calls/actions.ts:54-70` — filters not fully covered by existing index

### Phase F — Realtime/polling cleanup
- `src/components/admin/global-knowledge/knowledge-manager.tsx:137-144` — `setInterval(router.refresh, 5000)`
- `src/components/integrations/evolution-setup-flow.tsx:373-380` — 8s QR poll, no stop condition
- `src/components/calls/incoming-call-banner.tsx:24-37` — uncached contact-by-phone lookup per incoming call
- Confirmed healthy (no action needed): `src/hooks/use-outbound-call-status.ts`, `src/components/chat/hooks/use-chat-realtime.ts`, `src/hooks/use-unread-count.ts` realtime portion, `src/components/campaigns/contact-status-board.tsx`

### Phase G — Build tooling
- `next.config.ts` — no `experimental.optimizePackageImports`, no bundle analyzer
- `package.json` — `build` script uses `next build --webpack` (Turbopack bundler not used for production build)

## Notes

This seed was produced from a parallel 5-agent codebase audit on 2026-07-04, each covering one dimension:
1. Calls page components (pages, dialogs, timeline, voice settings, Twilio provider)
2. Dashboard root layout, RBAC, sidebar, org switcher, notification bell
3. Supabase query patterns system-wide (select(*), N+1, sequential awaits, indexes)
4. Client bundle composition (next.config, package.json deps, 'use client' placement, dynamic-import usage)
5. Realtime subscriptions and polling intervals system-wide

The audit was explicitly scoped read-only — no code changes were made. Two commits touched Calls just before this audit and are relevant context for Phase A/B execution: `ebf096d4` (CallDetailSheet → CallDetailDialog) and `6bd9e0d6` (fix SSR crash by moving `voice-settings-tabs.ts` helpers out of a `'use client'` module). Per memory, a separate `v3.5 Calls overhaul` initiative is already in flight outside GSD (spec at `.planning/v35-calls-overhaul/SPEC.md`, executed directly without GSD phases) — Phase A/B of this seed overlaps its file surface and should be coordinated with it rather than executed blind.

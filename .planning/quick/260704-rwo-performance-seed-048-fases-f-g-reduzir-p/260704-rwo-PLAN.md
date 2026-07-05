---
phase: 260704-rwo-performance-seed-048-fases-f-g-reduzir-p
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/admin/global-knowledge/knowledge-manager.tsx
  - src/components/integrations/evolution-setup-flow.tsx
  - src/components/calls/incoming-call-banner.tsx
  - supabase/migrations/1244_global_knowledge_notion_realtime.sql
  - next.config.ts
autonomous: true
requirements: [SEED-048-F, SEED-048-G]
must_haves:
  truths:
    - "The Knowledge Manager admin page no longer polls with a full router.refresh() every 5 seconds while a Notion sync is active — it reacts to a Supabase realtime subscription on the sync-jobs/roots tables instead"
    - "The Evolution WhatsApp QR setup flow stops polling as soon as the connection reaches the connected state, instead of continuing to hit the server every 8 seconds indefinitely"
    - "Repeat incoming calls from the same phone number within a session do not trigger a redundant /api/voice/contact-by-phone fetch"
    - "next.config.ts declares experimental.optimizePackageImports for at least @phosphor-icons/react (the one broadly-imported icon package not already covered by Next.js's built-in default optimization list)"
  artifacts:
    - path: "src/components/admin/global-knowledge/knowledge-manager.tsx"
      provides: "Supabase realtime subscription on global_knowledge_sync_jobs (and/or global_knowledge_notion_roots) replacing the setInterval(router.refresh, 5000) polling loop"
    - path: "supabase/migrations/1244_global_knowledge_notion_realtime.sql"
      provides: "ALTER PUBLICATION supabase_realtime ADD TABLE for global_knowledge_sync_jobs and global_knowledge_notion_roots, plus REPLICA IDENTITY FULL on both so postgres_changes payloads include full rows when filtered by non-PK columns"
    - path: "src/components/integrations/evolution-setup-flow.tsx"
      provides: "QRCodeCard interval callback that clears itself once getEvolutionQRCode() reports status === 'connected'"
    - path: "src/components/calls/incoming-call-banner.tsx"
      provides: "Module-level short-TTL cache keyed by phone number guarding the /api/voice/contact-by-phone fetch"
    - path: "next.config.ts"
      provides: "experimental.optimizePackageImports: ['@phosphor-icons/react'] added to the exported NextConfig"
  key_links:
    - from: "src/components/admin/global-knowledge/knowledge-manager.tsx"
      to: "global_knowledge_sync_jobs / global_knowledge_notion_roots (postgres_changes)"
      via: "supabase.channel(...).on('postgres_changes', { schema: 'public', table: ..., filter: 'connection_id=eq.<id>' }, handler).subscribe(), cleaned up via supabase.removeChannel in the effect's return"
      pattern: "postgres_changes"
    - from: "src/components/integrations/evolution-setup-flow.tsx"
      to: "getEvolutionQRCode()"
      via: "interval callback checks the resolved status and calls clearInterval on the id once status === 'connected'"
      pattern: "clearInterval"
    - from: "src/components/calls/incoming-call-banner.tsx"
      to: "/api/voice/contact-by-phone"
      via: "module-level Map<string, {name, fetchedAt}> checked before fetch, TTL ~5 minutes"
      pattern: "Map<string"
---

<objective>
Execute SEED-048 Phase F (realtime & polling cleanup) and Phase G (build tooling, scoped subset) as a pure performance/efficiency refactor. No visible behavior change beyond "stops polling when it should" and "doesn't re-fetch when already cached." Completing this plan closes out all of SEED-048 (Phases A-G) — Phases A/C shipped as quick task 260704-pr3, Phase B as 260704-r15, Phases D/E as 260704-r5t, and this plan ships the final F/G phases.

Purpose: Three components poll or fetch more aggressively than necessary — the Knowledge Manager's full-page-refresh-on-a-timer, the Evolution QR flow's polling with no stop condition, and the incoming-call banner's uncached per-call lookup — plus one quick build-tooling win (`optimizePackageImports`) that costs nothing and helps future bundle hygiene.

Output: Knowledge Manager reacts to Supabase realtime instead of `router.refresh()` polling; Evolution QR polling self-terminates on connection; incoming-call contact lookups are cached per-session with a 5-minute TTL; `next.config.ts` opts `@phosphor-icons/react` into Next.js's package-import optimization (the one broadly-used icon package not already covered by Next's built-in default list).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/seeds/SEED-048-system-performance-calls-page-latency.md
@CLAUDE.md

<verified_live_state>
Line numbers in the seed are approximate (Phases A-E already shipped and shifted surrounding code). The following was confirmed by reading the LIVE files before this plan was written — use these facts directly, do not re-derive from the seed.

**src/components/admin/global-knowledge/knowledge-manager.tsx** (current lines 137-144):
```tsx
useEffect(() => {
  const hasActiveSync =
    notionState.roots.some((root) => root.status === 'pending' || root.status === 'syncing') ||
    notionState.jobs.some((job) => job.status === 'queued' || job.status === 'processing')
  if (!hasActiveSync) return
  const timer = window.setInterval(() => router.refresh(), 5_000)
  return () => window.clearInterval(timer)
}, [notionState.jobs, notionState.roots, router])
```
This already has a smart early-stop condition (`hasActiveSync` guard) and clears on unmount/dependency change — but every 5s tick still does a full `router.refresh()` (server round-trip + full layout re-render), which is the actual waste the seed flags. `notionState` is passed down as a server-fetched prop from `getGlobalKnowledgeNotionState()` (in `src/app/(admin)/admin/knowledge/_actions/knowledge.ts`), which queries `global_knowledge_config`, `global_knowledge_notion_connections`, `global_knowledge_notion_roots`, and `global_knowledge_sync_jobs` (confirmed table name — the seed's guess of "notion_sync_jobs" was close but not exact). There is NO existing `notion_sync_jobs` table; the real table is `public.global_knowledge_sync_jobs` (migration `1220_global_knowledge_notion_sync.sql`), columns: `id, event_id, connection_id, root_id, notion_page_id, job_type, status ('queued'|'processing'|'succeeded'|'failed'), attempts, next_attempt_at, error_detail, payload, created_at, started_at, completed_at`. It has RLS: `platform_admins_read_global_knowledge_sync_jobs` (SELECT only, gated by `is_platform_admin()`) — readable by the authenticated platform-admin browser client used elsewhere in this admin page. `global_knowledge_notion_roots` similarly has a `platform_admins_manage_global_knowledge_notion_roots` policy (ALL, `is_platform_admin()`), so SELECT via realtime is also covered.

Neither `global_knowledge_sync_jobs` nor `global_knowledge_notion_roots` is currently added to the `supabase_realtime` publication (confirmed: no `ALTER PUBLICATION supabase_realtime ADD TABLE` migration exists for either table — grepped all of `supabase/migrations/`). Both also lack `REPLICA IDENTITY FULL` (default is PK-only), which matters because the client needs to filter/read by `connection_id` (a non-PK FK column) — a new migration is required to (a) add both tables to the publication and (b) set `REPLICA IDENTITY FULL` on both, mirroring the documented `campaign_contacts` precedent (`005_campaigns.sql:63-66`, `REPLICA IDENTITY FULL` explicitly called out as "CRITICAL... so Supabase Realtime broadcasts the full updated row, not just the PK"). Precedent for the idempotent publication-add pattern is `supabase/migrations/1206_call_logs_realtime.sql`:
```sql
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

The reference pattern cited in the seed, `src/components/campaigns/contact-status-board.tsx` (lines 50-74), does exactly this shape:
```tsx
useEffect(() => {
  const supabase = createClient()
  const channel = supabase
    .channel(`campaign-contacts-${campaignId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'campaign_contacts',
      filter: `campaign_id=eq.${campaignId}`,
    }, (payload) => {
      const updated = payload.new as CampaignContactRow
      setContacts((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))
    })
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [campaignId])
```
`createClient` for the browser is imported from `@/lib/supabase/client` (confirmed export used in `contact-status-board.tsx`).

**Decision for this plan:** the "active state" for the Knowledge Manager spans TWO heterogeneous concerns (root sync status AND queued/processing sync jobs) tied to `notionState.connection.id`, not a single row. Subscribing to `global_knowledge_sync_jobs` filtered by `connection_id=eq.<connectionId>` is the cleanest single subscription — a job transitioning to `succeeded`/`failed` is the actual signal that a sync finished (roots update as a side effect of job completion via `complete_global_knowledge_root_sync()`), so listening to job changes captures the state transition without needing a second subscription on roots. On any `postgres_changes` event on this channel, call `router.refresh()` ONCE (not on a timer) to re-pull the server-rendered `notionState` prop with fresh data — this replaces polling entirely with event-driven refresh. Skip subscribing to `global_knowledge_notion_roots` separately to keep the fix to one channel; this is a reasonable, safely-achievable scope per the task's own guidance to prefer realtime where the data model supports it cleanly, without over-engineering to two channels for a rarely-changing admin screen.

**src/components/integrations/evolution-setup-flow.tsx** (current lines 359-380, function `QRCodeCard`):
```tsx
async function refresh() {
  setRefreshing(true)
  const res = await getEvolutionQRCode()
  setRefreshing(false)
  if (!res.ok) { toast.error(res.error); return }
  setQr(res.data)
}

useEffect(() => {
  refresh()
  const id = setInterval(() => { refresh() }, 8000)
  return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```
`getEvolutionQRCode()` (`src/app/(dashboard)/integrations/evolution/actions.ts:201-257`) returns `{ ok: true; data: QRCodeView }` where `QRCodeView.status` is `'disconnected' | 'connecting' | 'connected' | 'qr_pending'`. Confirmed: when the underlying Evolution instance state is `'open'`, `domainStatus` is set to `'connected'` and the function returns early with `{ base64: null, code: null, status: 'connected', phoneNumber: phone }` — `'connected'` is the clean terminal state to detect. The parent component `EvolutionSetupFlow` already re-derives `step` from `qr?.status` via `deriveStep()` and swaps `QRCodeCard` out for `ConnectedCard` once `step === 'connected'` — but that swap only happens on next render AFTER `setQr(res.data)` fires, so `QRCodeCard` itself must stop its own interval the moment it receives a `'connected'` status, since the component doesn't unmount instantly at that exact tick (it unmounts once the parent re-renders past the `step === 'qr'` branch, but the interval that already fired needs to not schedule the NEXT tick).

**src/components/calls/incoming-call-banner.tsx** (full file, 81 lines, confirmed untouched by any prior SEED-048 phase — last git-touched at v2.1 call system introduction):
```tsx
React.useEffect(() => {
  if (!fromNumber) return
  let cancelled = false
  fetch(`/api/voice/contact-by-phone?phone=${encodeURIComponent(fromNumber)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { name?: string } | null) => {
      if (cancelled) return
      setContactName(data?.name ?? null)
    })
    .catch(() => undefined)
  return () => { cancelled = true }
}, [fromNumber])
```
No caching exists at all today — every incoming call (even a repeat caller within the same session) re-fetches. This is a client component (`'use client'`) already; a module-level `Map` persists across re-mounts within the same browser tab/session (component may mount/unmount as calls come and go, but the module scope survives).

**next.config.ts** (confirmed current shape, Next.js `^16.2.6`): exported `NextConfig` object has `output`, `serverExternalPackages`, `turbopack: {}`, `redirects`, `rewrites`, `headers` — NO `experimental` key exists yet. Confirmed via `node_modules/next/dist/docs/.../optimizePackageImports.md` that `experimental.optimizePackageImports` is still the correct (not-yet-graduated) flag name in this Next.js version, and that Next.js ships a BUILT-IN default-optimized list that already includes `lucide-react`, `date-fns`, and `recharts` (all three are dependencies here) — adding those three explicitly would be redundant. `@phosphor-icons/react` (also a dependency, imported across 8 files in `src/`) is NOT in the default list, making it the one package genuinely worth adding. `package.json`'s `build` script is `next build --webpack` — per task scope, do NOT touch this (needs git-history archaeology beyond a quick task). No `@next/bundle-analyzer` dependency exists and none will be added — Next.js 16.1+ ships a built-in `next experimental-analyze` command requiring no new dependency, so bundle visibility is already available without adding anything; not wiring it into this plan since it's a manual on-demand CLI command, not a config change.

**Migration numbering**: highest existing migration file is `1243_call_logs_org_direction_date_index.sql` (from prior quick task 260704-r5t, not yet applied to remote per that task's SUMMARY). Next: `1244`.

**IMPORTANT — do NOT touch**: any file already modified by Phases A-E (see task_scope constraints) — none of this plan's target files overlap with those. Confirmed via `git log --oneline` that `incoming-call-banner.tsx`, `knowledge-manager.tsx`, and `evolution-setup-flow.tsx` were not touched by commits `570a3bcd`, `de5d7591`, `6bf909e2`, `2ed200f5`, `53284e8c`, `d76dc2ec`, `b2e13468`.
</verified_live_state>

<interfaces>
From src/lib/supabase/client.ts (reuse directly, no exploration needed):
```typescript
export function createClient(): SupabaseClient<Database>
```

From src/app/(admin)/admin/knowledge/_actions/knowledge.ts (existing shape, do not change):
```typescript
export async function getGlobalKnowledgeNotionState(): Promise<{
  sourceMode: string
  connection: { id: string; workspace_name: string | null; status: string; error_detail: string | null; last_synced_at: string | null } | null
  roots: Array<{ id: string; title: string; platform: GlobalKnowledgePlatform; status: string; error_detail: string | null; last_full_sync_at: string | null }>
  jobs: Array<{ id: string; status: string; job_type: string; error_detail: string | null }>
}>
```

From src/app/(dashboard)/integrations/evolution/actions.ts (existing shape, do not change):
```typescript
export interface QRCodeView {
  base64: string | null
  code: string | null
  status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
  phoneNumber: string | null
}
export async function getEvolutionQRCode(): Promise<{ ok: true; data: QRCodeView } | { ok: false; error: string }>
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Replace Knowledge Manager polling with realtime + add stop condition to Evolution QR poll (Phase F, part 1)</name>
  <files>src/components/admin/global-knowledge/knowledge-manager.tsx, src/components/integrations/evolution-setup-flow.tsx, supabase/migrations/1244_global_knowledge_notion_realtime.sql</files>
  <action>
    1. Create `supabase/migrations/1244_global_knowledge_notion_realtime.sql`:
       ```sql
       -- =============================================================================
       -- Migration 1244: Enable Realtime for global knowledge Notion sync (SEED-048 Phase F)
       --
       -- The Knowledge Manager admin page (src/components/admin/global-knowledge/
       -- knowledge-manager.tsx) previously polled with setInterval(router.refresh, 5000)
       -- while a Notion sync was active. Replacing that with a Supabase realtime
       -- subscription on global_knowledge_sync_jobs requires the table to be part of
       -- the supabase_realtime publication, and REPLICA IDENTITY FULL so postgres_changes
       -- payloads include full rows when filtered by connection_id (a non-PK column).
       -- Idempotent: wraps the ALTER in a DO block that swallows duplicate_object errors.
       -- =============================================================================

       ALTER TABLE public.global_knowledge_sync_jobs REPLICA IDENTITY FULL;
       ALTER TABLE public.global_knowledge_notion_roots REPLICA IDENTITY FULL;

       DO $$
       BEGIN
         ALTER PUBLICATION supabase_realtime ADD TABLE public.global_knowledge_sync_jobs;
       EXCEPTION
         WHEN duplicate_object THEN NULL;
       END $$;

       DO $$
       BEGIN
         ALTER PUBLICATION supabase_realtime ADD TABLE public.global_knowledge_notion_roots;
       EXCEPTION
         WHEN duplicate_object THEN NULL;
       END $$;
       ```
       Do not apply this migration (no `npx supabase db push` / MCP `apply_migration` call) — file creation only, consistent with how prior SEED-048 index migrations were left for the operator to apply. Note this in the final SUMMARY.

    2. `src/components/admin/global-knowledge/knowledge-manager.tsx`: Replace the `setInterval(() => router.refresh(), 5_000)` polling effect (current lines 137-144) with a Supabase realtime subscription on `global_knowledge_sync_jobs`, filtered by `connection_id`. Add the browser client import:
       ```tsx
       import { createClient } from '@/lib/supabase/client'
       ```
       Replace the polling `useEffect` with:
       ```tsx
       useEffect(() => {
         const connectionId = notionState.connection?.id
         if (!connectionId) return
         const supabase = createClient()
         const channel = supabase
           .channel(`global-knowledge-sync-${connectionId}`)
           .on(
             'postgres_changes',
             {
               event: '*',
               schema: 'public',
               table: 'global_knowledge_sync_jobs',
               filter: `connection_id=eq.${connectionId}`,
             },
             () => router.refresh(),
           )
           .subscribe()
         return () => {
           supabase.removeChannel(channel)
         }
       }, [notionState.connection?.id, router])
       ```
       This subscribes whenever a Notion connection exists (not gated on `hasActiveSync`, since the whole point is to react to a sync starting/progressing/finishing without polling — the subscription itself is cheap and idle when nothing changes, unlike the timer it replaces). Remove the now-unused `hasActiveSync` computation if it was only used by the old effect (check the rest of the file for other uses of `notionState.roots`/`notionState.jobs` status checks first — the `notionSourcesByRoot` memo and JSX rendering of `root.status` still need `notionState.roots`, so only remove the polling-specific derived boolean, not `notionState.roots`/`notionState.jobs` themselves).

    3. `src/components/integrations/evolution-setup-flow.tsx`: Add a stop condition to the QR poll so it clears itself once the connection succeeds. Modify the `useEffect` inside `QRCodeCard` (current lines 373-380):
       ```tsx
       useEffect(() => {
         let stopped = false
         async function tick() {
           if (stopped) return
           await refresh()
         }
         tick()
         const id = setInterval(async () => {
           if (stopped) return
           const res = await getEvolutionQRCode()
           if (!res.ok) {
             toast.error(res.error)
             return
           }
           setQr(res.data)
           if (res.data.status === 'connected') {
             stopped = true
             clearInterval(id)
           }
         }, 8000)
         return () => {
           stopped = true
           clearInterval(id)
         }
         // eslint-disable-next-line react-hooks/exhaustive-deps
       }, [])
       ```
       This duplicates the `getEvolutionQRCode()` call/`setQr` logic already in `refresh()` inside the interval tick specifically so the status check can happen inline before deciding whether to keep polling (the standalone `refresh()` helper stays for the "Refresh now" button's onClick, unchanged). Import `getEvolutionQRCode` is already present in this file's existing imports — no new import needed.
  </action>
  <verify>
    <automated>npm run build</automated>
  </verify>
  <done>Knowledge Manager no longer runs a 5-second setInterval calling router.refresh(); instead it subscribes to postgres_changes on global_knowledge_sync_jobs filtered by connection_id and refreshes once per actual change event, cleaned up via supabase.removeChannel on unmount. A new idempotent migration file 1244 adds both global_knowledge_sync_jobs and global_knowledge_notion_roots to the supabase_realtime publication with REPLICA IDENTITY FULL. The Evolution QR poll's interval callback checks status and calls clearInterval once status is 'connected', instead of polling indefinitely while mounted. npm run build passes with no type errors.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Cache incoming-call contact lookups + add optimizePackageImports (Phase F part 2 + Phase G)</name>
  <files>src/components/calls/incoming-call-banner.tsx, next.config.ts</files>
  <action>
    1. `src/components/calls/incoming-call-banner.tsx`: Add a module-level short-TTL cache keyed by phone number, checked before firing `/api/voice/contact-by-phone`. Add above the component definition:
       ```tsx
       const CONTACT_LOOKUP_TTL_MS = 5 * 60 * 1000 // 5 minutes
       const contactLookupCache = new Map<string, { name: string | null; fetchedAt: number }>()
       ```
       Replace the existing lookup `useEffect` (current lines 24-37) with:
       ```tsx
       React.useEffect(() => {
         if (!fromNumber) return

         const cached = contactLookupCache.get(fromNumber)
         if (cached && Date.now() - cached.fetchedAt < CONTACT_LOOKUP_TTL_MS) {
           setContactName(cached.name)
           return
         }

         let cancelled = false
         fetch(`/api/voice/contact-by-phone?phone=${encodeURIComponent(fromNumber)}`)
           .then((r) => (r.ok ? r.json() : null))
           .then((data: { name?: string } | null) => {
             const name = data?.name ?? null
             contactLookupCache.set(fromNumber, { name, fetchedAt: Date.now() })
             if (cancelled) return
             setContactName(name)
           })
           .catch(() => undefined)
         return () => {
           cancelled = true
         }
       }, [fromNumber])
       ```
       Note: the cache is intentionally module-level (not component state) so it survives the banner mounting/unmounting between calls within the same browser tab session — this is the "short-TTL in-memory cache" the task calls for, not a persistent/cross-session cache. No cache eviction/size cap is needed given the low volume of distinct incoming numbers per session; do not over-engineer this into a LRU cache.

    2. `next.config.ts`: Add `experimental.optimizePackageImports` for `@phosphor-icons/react` — the one broadly-imported icon package not already covered by Next.js's built-in default optimization list (which already includes `lucide-react`, `date-fns`, and `recharts`, confirmed via the installed Next.js 16.2.6 docs, so those three are NOT added here to avoid redundant config). Add the `experimental` key to the `nextConfig` object (after `turbopack: {}`):
       ```ts
       const nextConfig: NextConfig = {
         output: 'standalone',
         serverExternalPackages: ['sharp', 'playwright', 'playwright-core', 'cheerio'],
         turbopack: {},
         experimental: {
           optimizePackageImports: ['@phosphor-icons/react'],
         },
         // ...rest of the file (redirects, rewrites, headers) unchanged
       }
       ```
       Do not add a bundle analyzer dependency — Next.js 16.1+ already ships a built-in `next experimental-analyze` CLI command requiring no new devDependency, so this is deferred as unnecessary rather than risky. Do not touch the `package.json` `build` script's `--webpack` flag — deferred per task scope (requires git-history investigation into whether it was a deliberate workaround, out of scope for a quick task).
  </action>
  <verify>
    <automated>npm run build</automated>
  </verify>
  <done>A repeat incoming call from the same phone number within 5 minutes reads from the module-level cache instead of re-fetching /api/voice/contact-by-phone. next.config.ts's exported NextConfig includes experimental.optimizePackageImports: ['@phosphor-icons/react']. npm run build passes with no type errors, confirming this closes out all of SEED-048 (Phases A-G).</done>
</task>

</tasks>

<verification>
Run `npm run build` after both tasks (each task also runs it individually — the run after Task 2 is authoritative across all changes). Confirm:
- No new TypeScript errors.
- No file already modified by Phases A-E was touched (`git status` / `git diff --stat` should show only the five files in this plan's `files_modified`).
- No existing migration file under `supabase/migrations/` was edited — only the new `1244_global_knowledge_notion_realtime.sql` file was added.
- `grep -n "setInterval" src/components/admin/global-knowledge/knowledge-manager.tsx` returns no matches (polling fully replaced by realtime).
- `grep -n "clearInterval" src/components/integrations/evolution-setup-flow.tsx` shows the interval being cleared inside the tick callback, not just on unmount.

Manually confirm (no automated UI test exists in this repo for these flows):
- Admin > Global Knowledge page: trigger a Notion sync, confirm the page updates when the sync job completes without a visible 5-second refresh cadence (network tab shows a websocket/realtime connection, not a `router.refresh()` payload every 5s).
- Integrations > Evolution WhatsApp setup: scan the QR and connect; confirm the QR poll stops (no further `getEvolutionQRCode` calls in the network tab) once the "Connected" card appears.
- Trigger two incoming calls from the same number within 5 minutes (or inspect via code review): confirm only the first triggers a `/api/voice/contact-by-phone` network request.
</verification>

<success_criteria>
- Phase F: Knowledge Manager reacts to a Supabase realtime subscription on `global_knowledge_sync_jobs` instead of a 5-second `router.refresh()` timer; a new migration adds that table (and `global_knowledge_notion_roots`) to the `supabase_realtime` publication with `REPLICA IDENTITY FULL`. The Evolution QR poll stops itself once the connection reaches `'connected'` instead of polling indefinitely while mounted. Incoming-call contact lookups are cached per phone number with a 5-minute TTL, avoiding redundant fetches for repeat callers within a session.
- Phase G (scoped subset): `next.config.ts` adds `experimental.optimizePackageImports: ['@phosphor-icons/react']` — the one broadly-used icon package not already covered by Next.js 16's built-in default optimization list. The `package.json` `--webpack` build flag and adding a bundle-analyzer dependency are explicitly deferred (documented reasons: git-history archaeology needed for the former; already covered by Next's built-in `next experimental-analyze` CLI for the latter).
- No file already modified by SEED-048 Phases A-E was touched.
- No visible behavior change beyond "stops polling when it should" and "doesn't re-fetch when already cached."
- npm run build passes with zero type errors after both tasks are complete.
- The new migration 1244 is NOT applied to the remote DB by this plan's execution — called out in the SUMMARY as a follow-up step for the operator (`npx supabase db push` or Supabase MCP `apply_migration`), consistent with how prior SEED-048 migrations (1241-1243) were left pending.
- This plan's completion closes out all of SEED-048 (Phases A through G) — the SUMMARY should note this explicitly.
</success_criteria>

<output>
After completion, create `.planning/quick/260704-rwo-performance-seed-048-fases-f-g-reduzir-p/260704-rwo-SUMMARY.md`
</output>

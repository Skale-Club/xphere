# Phase 106: MERGE-TOOL — Research

**Researched:** 2026-05-25
**Domain:** Postgres SECURITY DEFINER function + Next.js admin RSC page + identity-aware write helper
**Confidence:** HIGH (FK list, migration number, admin patterns, UI primitives all verified against repo + prod DB)

## Summary

Phase 106 ships a manual-only merge tool (auto-merge deferred per D-01 with prod showing 0 clusters per the Phase 105 baseline). The work splits cleanly into four deliverables:

1. **Migration 1057** — `merge_contacts(survivor uuid, archived uuid)` SECURITY DEFINER function that rewrites FKs across **8 tables** (verified by probing `pg_constraint` on prod), marks the archived row, and writes `contact_merge_log`. Plus `contact_merge_exclusions`, `contacts.merged_into_contact_id`, and an updated `refresh_contact_duplicate_audit()` that excludes whitelisted pairs.
2. **`/admin/contacts/conflicts` page** — RSC under the existing `(admin)` route group; auth gate is already enforced by `src/app/(admin)/layout.tsx` (email equality check vs `PLATFORM_ADMIN_EMAIL`). Server actions live under `src/app/(admin)/admin/_actions/`.
3. **`resolveLiveContactId()` helper** — new module at `src/lib/contacts/server.ts`. Lookup + write call sites are concentrated in 5 files (enumerated below).
4. **Merged-banner component** — `src/components/contacts/merged-banner.tsx`. Note: there is **no `src/app/(dashboard)/contacts/[id]/page.tsx` today** (verified by glob); the banner is built for future detail pages and the conversation contact-info panel (`src/components/chat/contact-info-panel.tsx`, already in the modified-files list).

**Primary recommendation:** Author migration 1057 first with the verified 8-FK explicit-UPDATE list. Ship the admin page with a working empty state (today's reality). Wire `resolveLiveContactId` into the 5 write sites and leave lookup-path filtering for Phase 110 (only conversation linking and pipeline reads matter today, and those don't enter via archived rows because nothing is archived yet).

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Auto-merge is deferred from this phase. Phase 106 ships manual-only.
- **D-01a:** ROADMAP Phase 106 success criterion #5 (auto-merge) is rescinded. Updated criteria: #1, #2, #3, #4, #6, #7.
- **D-02:** `merge_contacts(survivor_id uuid, archived_id uuid)` SECURITY DEFINER in migration 1057. Explicit `UPDATE <table> SET contact_id = survivor_id WHERE contact_id = archived_id` per FK table. No generic helper, no `ON UPDATE CASCADE`, no dynamic SQL.
- **D-02a:** Single implicit transaction (function body). All-or-nothing.
- **D-02b:** Marks archived row: `UPDATE contacts SET identity_status='archived_duplicate', merged_into_contact_id=survivor_id, updated_at=now() WHERE id=archived_id`.
- **D-02c:** Inserts a row in `contact_merge_log` before returning (`auth.uid()` as `merged_by`, `strategy='manual'`).
- **D-02d:** Function returns `void`. App reads `contact_merge_log` for confirmation.
- **D-02e:** Researcher (this doc) enumerates every FK table. **DONE — see "FK Enumeration" below.**
- **D-03:** New `contact_merge_exclusions (org_id, contact_id_a, contact_id_b, excluded_by, excluded_at, reason, PRIMARY KEY (org_id, contact_id_a, contact_id_b), CHECK (contact_id_a < contact_id_b))`.
- **D-03a:** `a < b` CHECK enforces canonical ordering.
- **D-03b:** `refresh_contact_duplicate_audit()` updated in migration 1057 to exclude clusters where ALL pairwise combinations are present in exclusions. Partial exclusion does not hide cluster.
- **D-03c:** RLS: org admins (`org_memberships.role='admin'`) can insert/select; service role bypasses.
- **D-04:** Three behaviors — read paths show banner, write paths call `resolveLiveContactId`, lookup paths filter `identity_status <> 'archived_duplicate'`.
- **D-04a:** `merged_into_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL`. Nullable. Survivor has NULL.
- **D-04b:** Banner at `src/components/contacts/merged-banner.tsx`.
- **D-05:** `/admin/contacts/conflicts` route, super_admin only (existing email-equality gate).
- **D-05a:** Lists clusters ordered by `cluster_size DESC, detected_at ASC`.
- **D-05b:** Side-by-side contact cards (up to N=10 per cluster). Each card: name, phone (raw + normalized), email (raw + normalized), source, created_at, conversation count, message count.
- **D-05c:** "Merge into A / B / C…" buttons per contact (picks survivor) → confirm modal. "Mark as separate" at cluster level (writes all pairwise combos to `contact_merge_exclusions`).
- **D-05d:** "Refresh audit" button invokes `refresh_contact_duplicate_audit()` server-side and reloads.

### Claude's Discretion

- Exact migration filename (`1057_<slug>.sql` — recommend `1057_contact_merge_tool.sql`).
- RSC vs client component split (recommend RSC for the page shell, client component for the confirm modal + interactive buttons only).
- Pagination for large clusters (skip; baseline is 0 clusters — add only if cluster_size > 10).
- `WHERE archived_at IS NULL` filter on audit refresh. Recommendation: **do not add** — `contacts` has no `archived_at` column today, and the merge process uses `identity_status='archived_duplicate'`. The refresh function as written in migration 1056 already groups by `(org_id, phone_e164)` over `contacts` — it should additionally filter `identity_status <> 'archived_duplicate'` so archived rows stop forming clusters with their survivors. This is a critical correctness gap missed by the CONTEXT discretion question.

### Deferred Ideas (OUT OF SCOPE)

- Auto-merge of exact-match duplicates → Phase 106.1 or 110.
- Bulk merge UI.
- Undo merge.
- Merge from contact detail page (inline ergonomic).
- Notification to org members on merge → Phase 110.
- Webhook on merge (`contact.merged` workflow event) → Phase 110.
- Soft-delete of archived contacts after N days.

## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| CID-04 | Admin merge UI | Admin route pattern verified (`src/app/(admin)/layout.tsx:7-10` enforces super-admin via `PLATFORM_ADMIN_EMAIL`); shadcn primitives Card/Button/Dialog/AlertDialog/Badge/Skeleton all present in `src/components/ui/`. Sidebar nav definition at `src/components/admin/admin-sidebar.tsx:22-30` — add `{ href: '/admin/contacts/conflicts', label: 'Conflicts', icon: <pick from lucide, e.g. Users or GitMerge> }`. |
| CID-05 | Auto-merge — **DEFERRED per D-01.** Do not plan. | n/a |
| CID-06 | Archive strategy | `identity_status='archived_duplicate'` + `merged_into_contact_id` FK (D-02b, D-04a). Banner at `src/components/contacts/merged-banner.tsx`. `resolveLiveContactId` at `src/lib/contacts/server.ts` (5 write sites enumerated below). |

## Project Constraints (from CLAUDE.md)

- **`npm run build` mandatory after changes** — catches TS errors. Plan must include a build step after type regen for `contact_merge_log`, `contact_merge_exclusions`, `merged_into_contact_id` column.
- **Migration policy:** Numbered SQL files in `supabase/migrations/`, **never edit old ones**. Migration 1057 only.
- **RLS via `get_current_org_id()`** for all tenant-scoped tables. `contact_merge_exclusions` follows this. `contact_merge_log` is admin-only — RLS denies all SELECT by `authenticated`; only service role (server actions with assertAdmin) reads it.
- **Cached helpers:** Always `import { createClient, getUser } from '@/lib/supabase/server'` — never `supabase.auth.getUser()` directly. (`src/lib/supabase/server.ts:10-40` is the canonical source.)
- **Toasts via `sonner`.** No `react-hook-form` needed (click-driven UI per CONTEXT).
- **Webhooks return 200** — not relevant here (no inbound webhooks in this phase).
- **`supabase/functions/`** is Deno-only — not relevant (no edge function work in this phase).

## FK Enumeration (D-02e — drives `merge_contacts()` body)

Verified via prod query `SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE confrelid='public.contacts'::regclass AND contype='f'` (Phase 105 db-query.mjs harness, 2026-05-25).

| Table | Column | FK definition |
|---|---|---|
| `bookings` | `linked_contact_id` | `ON DELETE SET NULL` |
| `call_logs` | `contact_id` | `ON DELETE SET NULL` |
| `contact_tags` | `contact_id` | `ON DELETE CASCADE` |
| `conversations` | `contact_id` | `ON DELETE SET NULL` |
| `opportunities` | `contact_id` | `ON DELETE CASCADE` |
| `opportunity_contacts` | `contact_id` | `ON DELETE CASCADE` |
| `traffic_events` | `contact_id` | `ON DELETE SET NULL` |
| `traffic_visitors` | `contact_id` | `ON DELETE SET NULL` |

**Total: 8 tables, 1 of which uses `linked_contact_id` instead of `contact_id`.** The CONTEXT preliminary list (`messages`, `tasks`, `notes`, `contact_imports`, `contact_import_errors`, `custom_field_values`) was **wrong**:

- `messages` has NO `contact_id` column. It links to `conversations` only; rewriting `conversations.contact_id` covers all messages transitively.
- `tasks`, `notes`, `contact_imports`, `contact_import_errors`, `agent_invocations` have NO `contact_id` column (verified: `SELECT column_name FROM information_schema.columns WHERE column_name='contact_id'`).
- `ghl_events.contact_id` exists but is `text` (external GHL id) — **not** a contacts FK; do not rewrite.
- `unified_calls` is a view, not a table — do not rewrite.

**Edge cases for the function:**

- `contact_tags` and `opportunity_contacts` both have composite uniqueness implied by their join-table nature (`UNIQUE (contact_id, tag_id)` and `UNIQUE (opportunity_id, contact_id)` respectively — verify at plan time). Naive `UPDATE` may trip a unique violation if survivor already has the same tag/opportunity link. **Recommended pattern:** `INSERT...ON CONFLICT DO NOTHING` from archived → survivor, then `DELETE FROM <table> WHERE contact_id = archived_id`. See `merge_contacts` skeleton below.
- `opportunities.contact_id` and `opportunity_contacts.contact_id` are both `ON DELETE CASCADE`. Rewriting them is safe; we are not deleting.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| Postgres | 17.6 (Supabase) | Function host | Verified `SELECT current_setting('server_version')` on prod |
| `@supabase/ssr` | as installed | Cached server client | `src/lib/supabase/server.ts:10` |
| Next.js | 16 (App Router) | RSC + server actions | CLAUDE.md |
| shadcn/ui | as installed | UI primitives | Card, Button, Dialog, AlertDialog, Badge, Skeleton all confirmed in `src/components/ui/` |
| `sonner` | as installed | Toasts | CLAUDE.md established pattern |
| `lucide-react` | as installed | Icons (sidebar) | Used in `admin-sidebar.tsx:6-17` |

### Supporting

| Library | Purpose | When to Use |
|---|---|---|
| `pg` (db-query.mjs harness) | Pre-merge SQL probing in tests | `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/db-query.mjs` is the canonical harness |

### Don't install

- `react-hook-form` — not needed; merge UI is click-driven.
- `zod` for the merge action — payload is two UUIDs; a 3-line manual validator suffices. (Existing project uses Zod heavily; keep usage for consistency but don't add new dependencies.)

## Architecture Patterns

### File Structure (Phase 106 additions)

```
supabase/migrations/
  1057_contact_merge_tool.sql                  # NEW

src/app/(admin)/admin/contacts/conflicts/
  page.tsx                                     # NEW (RSC, lists clusters)
  _components/cluster-card.tsx                 # NEW (client component, side-by-side cards)
  _components/merge-confirm-dialog.tsx         # NEW (client, AlertDialog)

src/app/(admin)/admin/_actions/
  merge-contacts.ts                            # NEW (mergeContacts, markAsSeparate, refreshAudit)

src/lib/contacts/
  server.ts                                    # NEW (resolveLiveContactId)

src/components/contacts/
  merged-banner.tsx                            # NEW

src/components/admin/
  admin-sidebar.tsx                            # MODIFIED (add nav item)

src/types/database.ts                          # REGENERATED
```

### Pattern 1: Admin auth gate

The admin shell handles auth in the **layout**, not in middleware. Pages don't re-check.

```tsx
// src/app/(admin)/layout.tsx:7-10 — already in place
const user = await getUser()
if (!user) redirect('/')
if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) redirect('/dashboard')
```

Server actions duplicate the check (`assertAdmin()`):

```ts
// src/app/(admin)/admin/_actions/landing-config.ts:16-21 — canonical pattern to copy
async function assertAdmin() {
  const user = await getUser()
  if (!user || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    throw new Error('Unauthorized')
  }
}
```

Phase 106 server actions follow this exact pattern. Service-role client for cross-org reads (audit table has RLS scoped to `get_current_org_id()` but super-admin needs cross-org visibility — use `createServiceRoleClient()` from `@/lib/supabase/admin`).

### Pattern 2: `merge_contacts()` function skeleton (D-02)

```sql
CREATE OR REPLACE FUNCTION public.merge_contacts(
  survivor_id uuid,
  archived_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  survivor_org uuid;
  archived_org uuid;
  archived_status text;
  caller_uid uuid := auth.uid();
BEGIN
  -- Guard 1: same-id (D-pitfall-1)
  IF survivor_id = archived_id THEN
    RAISE EXCEPTION 'merge_contacts: survivor and archived must differ';
  END IF;

  -- Guard 2: load and lock both rows; check existence and cross-org
  SELECT org_id, identity_status INTO survivor_org, archived_status
    FROM public.contacts WHERE id = survivor_id FOR UPDATE;
  IF survivor_org IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: survivor % not found', survivor_id;
  END IF;
  IF archived_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'merge_contacts: survivor % is already archived', survivor_id;
  END IF;

  SELECT org_id, identity_status INTO archived_org, archived_status
    FROM public.contacts WHERE id = archived_id FOR UPDATE;
  IF archived_org IS NULL THEN
    RAISE EXCEPTION 'merge_contacts: archived % not found', archived_id;
  END IF;
  IF archived_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'merge_contacts: % is already archived', archived_id;
  END IF;
  IF survivor_org <> archived_org THEN
    RAISE EXCEPTION 'merge_contacts: cross-org merge not allowed (% vs %)',
      survivor_org, archived_org;
  END IF;

  -- FK rewrites (verified 8-table list, 2026-05-25 against prod)
  UPDATE public.bookings        SET linked_contact_id = survivor_id WHERE linked_contact_id = archived_id;
  UPDATE public.call_logs       SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.conversations   SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.opportunities   SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.traffic_events  SET contact_id        = survivor_id WHERE contact_id        = archived_id;
  UPDATE public.traffic_visitors SET contact_id       = survivor_id WHERE contact_id        = archived_id;

  -- Join tables: dedupe-then-delete pattern (avoids UNIQUE conflicts)
  INSERT INTO public.contact_tags (org_id, contact_id, tag_id)
    SELECT org_id, survivor_id, tag_id FROM public.contact_tags WHERE contact_id = archived_id
    ON CONFLICT DO NOTHING;
  DELETE FROM public.contact_tags WHERE contact_id = archived_id;

  INSERT INTO public.opportunity_contacts (org_id, opportunity_id, contact_id, is_primary)
    SELECT org_id, opportunity_id, survivor_id, is_primary FROM public.opportunity_contacts WHERE contact_id = archived_id
    ON CONFLICT DO NOTHING;
  DELETE FROM public.opportunity_contacts WHERE contact_id = archived_id;

  -- Mark archived contact
  UPDATE public.contacts
     SET identity_status = 'archived_duplicate',
         merged_into_contact_id = survivor_id,
         updated_at = now()
   WHERE id = archived_id;

  -- Audit log
  INSERT INTO public.contact_merge_log
    (org_id, survivor_id, archived_id, merged_by, merged_at, strategy)
  VALUES
    (survivor_org, survivor_id, archived_id, caller_uid, now(), 'manual');
END;
$$;

REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO authenticated;
```

**Planner notes:**
- `FOR UPDATE` row locks prevent concurrent merges of the same row.
- The exact column list for `contact_tags` / `opportunity_contacts` inserts must be verified at plan time against `1060_tags_system.sql` and `1039_opportunity_contacts.sql` (column names assumed).
- Function is one implicit transaction (PL/pgSQL function bodies are atomic outside explicit subtransactions).
- `auth.uid()` returns NULL if called from service role. That's expected for future automation; for Phase 106 the server action runs with the authenticated user's JWT cookie passed through, so `auth.uid()` resolves to the admin's user id.

### Pattern 3: `contact_merge_log` shape (Q7)

```sql
CREATE TABLE public.contact_merge_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  survivor_id     uuid NOT NULL,       -- no FK: survivor may itself be merged later; preserve history
  archived_id     uuid NOT NULL,       -- no FK: same reason
  merged_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  merged_at       timestamptz NOT NULL DEFAULT now(),
  strategy        text NOT NULL CHECK (strategy IN ('manual','auto','import-dedup')),
  cluster_id      uuid REFERENCES public.contact_duplicate_audit(cluster_id) ON DELETE SET NULL,
  affected_rows   jsonb  -- optional per-table counts; populate from function if cheap, else NULL
);

CREATE INDEX idx_cml_org_merged_at ON public.contact_merge_log (org_id, merged_at DESC);
CREATE INDEX idx_cml_survivor      ON public.contact_merge_log (survivor_id);
CREATE INDEX idx_cml_archived      ON public.contact_merge_log (archived_id);

ALTER TABLE public.contact_merge_log ENABLE ROW LEVEL SECURITY;
-- No policies: only service role + SECURITY DEFINER can read/write.
-- Super-admin server actions use createServiceRoleClient() to query.
```

Strategy enum includes `'auto'` and `'import-dedup'` for future phases even though only `'manual'` is written in 106. This avoids re-altering the CHECK constraint later (same pattern as `identity_status` CHECK in migration 1056).

### Pattern 4: `contact_merge_exclusions` shape (D-03)

```sql
CREATE TABLE public.contact_merge_exclusions (
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id_a  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  contact_id_b  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  excluded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  excluded_at   timestamptz NOT NULL DEFAULT now(),
  reason        text,
  PRIMARY KEY (org_id, contact_id_a, contact_id_b),
  CHECK (contact_id_a < contact_id_b)
);

ALTER TABLE public.contact_merge_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_merge_exclusions_select
  ON public.contact_merge_exclusions FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

CREATE POLICY contact_merge_exclusions_insert
  ON public.contact_merge_exclusions FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_memberships
       WHERE user_id = auth.uid()
         AND org_id  = contact_merge_exclusions.org_id
         AND role    = 'admin'
    )
  );
```

(Plan should confirm `org_memberships` column names against migration `046_org_invites.sql` / `001_foundation.sql`.)

### Pattern 5: Updated `refresh_contact_duplicate_audit()` (D-03b)

Drop-and-recreate (`CREATE OR REPLACE`). New logic: after detecting a cluster, check whether every pair `(a,b)` with `a<b` from the cluster is in `contact_merge_exclusions`. If yes, skip; otherwise insert.

```sql
-- Sketch (PL/pgSQL):
-- For each candidate cluster (org_id, contact_ids[]):
--   SELECT count(*) FILTER (... excluded ...) FROM unnest_pairs(contact_ids)
--   If count == n*(n-1)/2 then skip
-- Add filter: WHERE identity_status <> 'archived_duplicate' (correctness gap, see Discretion above)
```

**Also add** `WHERE identity_status <> 'archived_duplicate'` to the source `contacts` query so archived rows don't appear in future audit refreshes.

### Pattern 6: `resolveLiveContactId` (D-04)

```ts
// src/lib/contacts/server.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * Identity-aware contact id resolution.
 *
 * If `contactId` points to an archived_duplicate row, returns the
 * merged_into_contact_id (the live survivor). Otherwise returns input unchanged.
 *
 * Call this from every server action that takes a contact_id and writes to a
 * contact-linked table. Read paths (detail page, list) should NOT call this —
 * they need to render the archived row with the merged banner.
 */
export async function resolveLiveContactId(contactId: string): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, identity_status, merged_into_contact_id')
    .eq('id', contactId)
    .maybeSingle()
  if (error || !data) return contactId
  if (data.identity_status === 'archived_duplicate' && data.merged_into_contact_id) {
    // Recurse once to follow chain (A→B→C). Bounded depth: archived rows
    // cannot themselves be merge targets (guarded by merge_contacts).
    return resolveLiveContactId(data.merged_into_contact_id)
  }
  return contactId
}
```

**Chain protection (Pitfall 10):** The merge_contacts guard `IF archived_status = 'archived_duplicate'` on the **survivor** prevents creating chains in the first place — you cannot merge into an already-archived contact. So `resolveLiveContactId` should never recurse more than once in practice. The recursion is defensive only.

### Pattern 7: Server actions that write `contact_id` (need `resolveLiveContactId`)

Enumerated via `Grep "contact_id\s*:"` across `src/app` and `src/lib` (2026-05-25):

| File | Line | Operation | Action |
|---|---|---|---|
| `src/app/(dashboard)/chat/actions.ts` | 186 | `update conversations.contact_id` | wrap `contactId` with `resolveLiveContactId` |
| `src/app/(dashboard)/contacts/actions.ts` | 979 | `update conversations.contact_id` (auto-link job) | wrap `contactId` |
| `src/app/(dashboard)/pipeline/actions.ts` | 375, 528, 542 | insert opportunity / opportunity_contacts / update opportunity | wrap `data.contact_id`, `contactId` |
| `src/app/(dashboard)/scheduling/_actions/bookings.ts` | (uses `linked_contact_id`) | insert booking | wrap before insert |
| `src/app/(dashboard)/companies/actions.ts` | | uses `contact_id:` | wrap |
| `src/app/(dashboard)/settings/tags/actions.ts` | | `contact_tags.contact_id` insert | wrap |
| `src/app/api/twilio/voice/route.ts` | | webhook insert | wrap |

Library-layer writes (background/webhook paths — `src/lib/ghl/process-event.ts`, `src/lib/whatsapp/process-message.ts`, `src/lib/telegram/process-update.ts`, `src/lib/evolution/process-event.ts`, `src/lib/campaigns/outbound.ts`, `src/lib/flows/engine.ts`, `src/lib/automations/ghl-reengagement/runner.ts`, `src/lib/action-engine/executors/pipeline-actions.ts`, `src/lib/copilot/tools/pipeline.ts`) — these create contacts or are dispatch-side and don't typically receive archived ids from user input. Plan **should** wrap user-input-facing actions in dashboard `_actions/` first; library/webhook paths in a follow-up task to keep PR size sane. Document the deferred set explicitly so it's not lost.

### Pattern 8: Banner component (D-04b)

```tsx
// src/components/contacts/merged-banner.tsx
import Link from 'next/link'
import { ArrowRight, AlertCircle } from 'lucide-react'

export function MergedBanner({ survivorId, survivorName }: { survivorId: string; survivorName: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm">
      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="text-text-secondary">This contact was merged into</span>
      <Link href={`/contacts/${survivorId}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
        {survivorName ?? 'survivor'} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
```

Note: `src/app/(dashboard)/contacts/[id]/page.tsx` does **not exist today** (verified by glob). The banner is built for future detail pages and for the existing `src/components/chat/contact-info-panel.tsx` (which is in the working-tree modified file list and is the only place that currently displays a single contact). Plan should explicitly land the banner in `contact-info-panel.tsx` to validate it visually.

### Anti-Patterns to Avoid

- **Dynamic SQL for FK rewrites.** Explicit `UPDATE` per table (D-02). Easier to audit, easier to add new tables later via new migrations.
- **Generic helper that loops over `pg_constraint`.** Same reason — implicit schemas hide bugs.
- **`ON UPDATE CASCADE` on the contacts PK.** Survivor's id is preserved; only archived rows have FKs rewritten away.
- **Running `merge_contacts` from client-side code.** Server actions only; client never has direct DB access in Next.js App Router with SSR cookies.
- **Calling `refresh_contact_duplicate_audit()` on every page load.** It's TRUNCATE+INSERT — expensive. Only fire from "Refresh audit" button (D-05d).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| FK enumeration at runtime | `pg_constraint` introspection loop in PL/pgSQL | Explicit `UPDATE` statements per migration 1057 | D-02 forbids; explicit is auditable |
| Permission gating | Custom RBAC table | Existing `PLATFORM_ADMIN_EMAIL` check in `src/app/(admin)/layout.tsx:10` and `assertAdmin()` in admin `_actions/` | Already established; consistent with rest of `/admin` shell |
| Confirm modal | Plain `<dialog>` or custom z-index management | `<AlertDialog>` from `src/components/ui/alert-dialog.tsx` | shadcn primitive already installed |
| Cluster pair generation in client code | JS loops | SQL `unnest(contact_ids)` + lateral join when checking exclusions, or PL/pgSQL helper inside `refresh_contact_duplicate_audit()` | Keep set logic in the DB |
| Cross-org admin visibility | Custom RLS bypass | `createServiceRoleClient()` from `@/lib/supabase/admin` | Already used by `src/app/(admin)/admin/_actions/landing-config.ts:24` |

## Common Pitfalls

### Pitfall 1: same-id merge
**What:** Caller passes `survivor_id == archived_id`. Naive function archives the only contact.
**Avoid:** `IF survivor_id = archived_id THEN RAISE EXCEPTION` guard (in skeleton above).

### Pitfall 2: already-archived target
**What:** Caller tries to merge into a contact that's already archived.
**Avoid:** Check `survivor.identity_status <> 'archived_duplicate'` AND `archived.identity_status <> 'archived_duplicate'` (both directions).

### Pitfall 3: cross-org merge
**What:** Caller passes ids from different orgs (e.g., manipulated payload). FK rewrites would leak data across tenants.
**Avoid:** Check `survivor.org_id = archived.org_id` in function. Also enforce at server-action layer (load both contacts via authenticated client; RLS will hide cross-org ones, so the action sees only one and errors).

### Pitfall 4: UNIQUE constraint conflicts on join tables
**What:** `contact_tags` and `opportunity_contacts` likely have `UNIQUE (contact_id, tag_id)` / `UNIQUE (opportunity_id, contact_id)`. Rewriting archived→survivor where survivor already has the same link fails.
**Avoid:** `INSERT...ON CONFLICT DO NOTHING` + `DELETE` pattern (see skeleton). Verify each join table's unique constraint at plan time.

### Pitfall 5: generated columns and merge
**What:** `phone_e164` and `email_normalized` are STORED generated columns. They are recomputed on UPDATE of `phone`/`email` — but we don't update those in merge. The archived row keeps its phone/email post-merge.
**Status:** Expected and correct. Once Phase 107 adds the partial UNIQUE index `WHERE identity_status <> 'archived_duplicate'`, archived rows with duplicate phone/email don't violate the index. **Plan must reference this for Phase 107 readiness.**

### Pitfall 6: refresh_contact_duplicate_audit re-detects archived↔survivor as a cluster
**What:** Migration 1056's `refresh_contact_duplicate_audit()` groups all contacts with the same `phone_e164`. After a merge, archived row and survivor still share the phone. The next refresh would re-cluster them.
**Avoid:** Migration 1057 update adds `WHERE identity_status <> 'archived_duplicate'` to both the phone and email queries inside `refresh_contact_duplicate_audit()`. This is a correctness fix; the CONTEXT Discretion bullet asked about `archived_at` (no such column), so the planner must use `identity_status`.

### Pitfall 7: exclusion CHECK ordering
**What:** `contact_merge_exclusions CHECK (contact_id_a < contact_id_b)` means the markAsSeparate action must always sort the pair before insert. UI passes `[id1, id2]` arbitrarily.
**Avoid:** In `markAsSeparate(clusterId, contactIds[])`, generate all pairs and canonicalize: `const [a, b] = [id1, id2].sort()` before insert.

### Pitfall 8: refresh function permissions
**What:** Migration 1056 has `GRANT EXECUTE ON FUNCTION public.refresh_contact_duplicate_audit() TO authenticated`. Any authenticated user can rebuild the audit. Costly but not harmful (idempotent, scoped by RLS on read side).
**Status:** Accept as-is. Admin button is the intended caller; if a regular user calls it, the only effect is CPU on the DB.

### Pitfall 9: server action transaction boundary
**What:** Server action calls `supabase.rpc('merge_contacts', ...)`. The RPC is one transaction. If the action subsequently calls `revalidatePath` and the page refetches, the read sees post-merge state. Order matters: do RPC first, then revalidate.
**Avoid:** Use the canonical order: assertAdmin → RPC → revalidatePath → return.

### Pitfall 10: merge chains (A→B, then B→C)
**What:** If Phase 110 ever allows merging a survivor (B has merged_into=NULL, but B has incoming merged_into from A; then B is merged into C, leaving A pointing at B which now points at C).
**Avoid:** The guard `IF survivor.identity_status = 'archived_duplicate' THEN RAISE EXCEPTION` (Pitfall 2's guard for the survivor side) **prevents the chain** by refusing to merge any contact whose `identity_status` is `archived_duplicate`. The survivor must be live. `resolveLiveContactId` recursion is defensive only. Plan should add a one-liner SQL probe in the test suite: `SELECT count(*) FROM contacts WHERE merged_into_contact_id IS NOT NULL AND identity_status <> 'archived_duplicate'` — must be 0.

### Pitfall 11: server-side `auth.uid()` in SECURITY DEFINER
**What:** When invoking via Supabase JS client RPC, the user's JWT is forwarded and `auth.uid()` returns the user id. When invoking via service role, `auth.uid()` returns NULL — `merged_by` becomes NULL.
**Status:** Acceptable. For Phase 106, server actions use the authenticated client (admin user's cookie), so `auth.uid()` resolves correctly. Document for future automation phases.

### Pitfall 12: empty state IS the day-1 experience (Q9)
**What:** Prod has 0 clusters per the baseline. The conflicts page renders empty 100% of the time on day one.
**Recommendation:** Empty state must look intentional, not broken. A single `Card` with: page title "Duplicate Conflicts" → subtitle "0 clusters detected" → `<Skeleton>`-style placeholder OR a positive icon + copy "No duplicate contacts detected. The audit was last refreshed at <timestamp>." plus the "Refresh audit" button. Show the last refresh timestamp (read `MAX(detected_at)` from `contact_duplicate_audit`, fall back to "never"). Synthetic test data path: planner should include a fixture SQL snippet in the test plan that inserts 2 contacts with the same phone, calls `refresh_contact_duplicate_audit()`, and verifies the cluster appears.

## Code Examples

### Server action — `mergeContacts(survivorId, archivedId)`

```ts
// src/app/(admin)/admin/_actions/merge-contacts.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'

async function assertAdmin() {
  const user = await getUser()
  if (!user || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    throw new Error('Unauthorized')
  }
  return user
}

export async function mergeContacts(survivorId: string, archivedId: string): Promise<void> {
  await assertAdmin()
  // Use the user-scoped client so auth.uid() forwards into merge_contacts()
  const supabase = await createClient()
  const { error } = await supabase.rpc('merge_contacts', {
    survivor_id: survivorId,
    archived_id: archivedId,
  })
  if (error) throw new Error(`Merge failed: ${error.message}`)
  revalidatePath('/admin/contacts/conflicts')
}

export async function markAsSeparate(orgId: string, contactIds: string[]): Promise<void> {
  await assertAdmin()
  const svc = createServiceRoleClient()
  const pairs: Array<{ org_id: string; contact_id_a: string; contact_id_b: string }> = []
  for (let i = 0; i < contactIds.length; i++) {
    for (let j = i + 1; j < contactIds.length; j++) {
      const [a, b] = [contactIds[i], contactIds[j]].sort()
      pairs.push({ org_id: orgId, contact_id_a: a, contact_id_b: b })
    }
  }
  const { error } = await svc.from('contact_merge_exclusions').upsert(pairs, { onConflict: 'org_id,contact_id_a,contact_id_b' })
  if (error) throw new Error(`Mark-as-separate failed: ${error.message}`)
  revalidatePath('/admin/contacts/conflicts')
}

export async function refreshAudit(): Promise<void> {
  await assertAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc('refresh_contact_duplicate_audit')
  if (error) throw new Error(`Refresh failed: ${error.message}`)
  revalidatePath('/admin/contacts/conflicts')
}
```

### Conflicts page (RSC shell)

```tsx
// src/app/(admin)/admin/contacts/conflicts/page.tsx
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { ClusterCard } from './_components/cluster-card'
import { RefreshAuditButton } from './_components/refresh-audit-button'

export default async function ConflictsPage() {
  const svc = createServiceRoleClient()
  const { data: clusters } = await svc
    .from('contact_duplicate_audit')
    .select('cluster_id, org_id, match_type, normalized_value, contact_ids, cluster_size, detected_at')
    .order('cluster_size', { ascending: false })
    .order('detected_at', { ascending: true })

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Duplicate Conflicts</h1>
          <p className="text-sm text-text-secondary mt-1">
            {clusters?.length ?? 0} cluster{clusters?.length === 1 ? '' : 's'} detected
          </p>
        </div>
        <RefreshAuditButton />
      </div>
      {clusters?.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {clusters?.map((c) => <ClusterCard key={c.cluster_id} cluster={c} />)}
        </div>
      )}
    </div>
  )
}
```

## Runtime State Inventory

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | `contacts` table: 1 row in prod, 0 clusters per baseline. `contact_duplicate_audit`: empty. | None — Phase 106 ships against empty state and is validated with synthetic fixtures. |
| Live service config | No external service holds the new merge state. No n8n/Datadog/Tailscale references to `merge_contacts`. | None. |
| OS-registered state | None — no Task Scheduler / launchd / pm2 jobs invoke merge logic. | None. |
| Secrets / env vars | `PLATFORM_ADMIN_EMAIL` already in env (used by `src/app/(admin)/layout.tsx:10`). No new secrets. | None. |
| Build artifacts | `src/types/database.ts` will be stale after migration 1057 — must regenerate (manual edit per CLAUDE.md, or via Supabase MCP types tool). | Type regen task in plan. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Postgres (prod) | merge_contacts function host | ✓ | 17.6 | — |
| Supabase project mwklvkmggmsintqcqfvu | apply migration 1057 | ✓ | — | — |
| `pg` Node client | test SQL probes via db-query.mjs | ✓ | (installed for Phase 105) | — |
| `PLATFORM_ADMIN_EMAIL` env var | admin auth gate | ✓ | — | — |
| `npm run build` | type check after migration | ✓ | — | — |
| Supabase MCP `apply_migration` | migration deploy | Known broken (Phase 105 finding: points at wrong project) | — | Use Supabase CLI `npx supabase db push` or branch flow per Phase 105 D-04 |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Supabase MCP — use CLI / branch flow established in Phase 105.

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest (per `tests/` directory in CLAUDE.md File Structure) |
| Config file | Verify at plan time — likely `vitest.config.ts` at repo root |
| Quick run command | `npx vitest run tests/contact-merge.test.ts` (file to create in Wave 0) |
| Full suite command | `npx vitest run && npm run build` |
| DB probe harness | `node .planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/db-query.mjs --query "..."` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| CID-04 | Conflicts page renders 0 clusters (empty state) | smoke (manual + visual) | `npm run dev` → visit `/admin/contacts/conflicts` as `PLATFORM_ADMIN_EMAIL` user | manual |
| CID-04 | Conflicts page renders synthetic cluster after fixture insert | integration (SQL probe + visual) | Fixture: insert 2 contacts with same phone in test org → `refresh_contact_duplicate_audit()` → reload page | manual + db-query.mjs |
| CID-04 | `mergeContacts` server action rejects non-admin caller | unit | `npx vitest run tests/contact-merge.test.ts -t "unauthorized"` | ❌ Wave 0 |
| CID-04 | "Mark as separate" inserts canonical-ordered pairs | unit | `npx vitest run tests/contact-merge.test.ts -t "exclusions"` | ❌ Wave 0 |
| CID-06 | `merge_contacts(A,B)` rewrites all 8 FK tables | SQL probe | `node db-query.mjs --file tests/sql/merge-fk-rewrite.sql` | ❌ Wave 0 |
| CID-06 | `merge_contacts(A,A)` errors | SQL probe | `node db-query.mjs --query "SELECT merge_contacts('uuid','same-uuid')"` expects error | ❌ Wave 0 |
| CID-06 | `merge_contacts` across orgs errors | SQL probe | fixture insert two contacts in different orgs → call → expect error | ❌ Wave 0 |
| CID-06 | `merge_contacts` on already-archived survivor errors | SQL probe | fixture: archive contact → attempt to merge into it → expect error | ❌ Wave 0 |
| CID-06 | Audit log row written on successful merge | SQL probe | post-merge: `SELECT * FROM contact_merge_log WHERE archived_id='...'` expects 1 row with strategy='manual' | ❌ Wave 0 |
| CID-06 | `resolveLiveContactId` follows merged_into chain | unit | `npx vitest run tests/resolve-live-contact-id.test.ts` | ❌ Wave 0 |
| CID-06 | `refresh_contact_duplicate_audit` excludes archived rows | SQL probe | post-merge: refresh → assert archived↔survivor pair absent from `contact_duplicate_audit` | ❌ Wave 0 |
| CID-06 | `refresh_contact_duplicate_audit` skips fully-excluded clusters | SQL probe | fixture: 2 dupes + exclusion row → refresh → assert cluster absent | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/contact-merge.test.ts tests/resolve-live-contact-id.test.ts`
- **Per wave merge:** `npx vitest run && npm run build`
- **Phase gate:** Full suite green + manual visual check of `/admin/contacts/conflicts` empty state + synthetic-cluster state before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `tests/contact-merge.test.ts` — Vitest suite covering server actions (auth, validation, RPC happy path, error paths). Uses Supabase test client.
- [ ] `tests/resolve-live-contact-id.test.ts` — Vitest unit test for the helper.
- [ ] `tests/sql/merge-fk-rewrite.sql` — declarative SQL fixture + assertions (insert contacts, insert one row per FK table pointing at archived, call merge, assert all moved).
- [ ] `tests/fixtures/contact-merge-seed.sql` — shared fixture for integration tests.
- [ ] Test org provisioning approach — verify with planner whether tests use a dedicated test org or rollback transactions per test.

*(None of these test files exist today; all are Wave 0 work.)*

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Polymorphic `contact_identities` table (Notion v3.0 original spec) | Generated columns on `contacts` + Phase 108 `contact_channel_identities` | ROADMAP counterproposal | Why merge_contacts only rewrites 8 FK tables, not a polymorphic identity table |
| ROADMAP success criterion #5 (auto-merge in Phase 106) | Deferred to Phase 106.1 or 110 | D-01 (CONTEXT.md, 2026-05-25) | Phase 106 scope is manual-only |

## Open Questions

1. **`org_memberships` exact role values for the exclusion RLS policy.**
   - What we know: D-03c says `role='admin'`.
   - What's unclear: Whether xphere uses `'admin'` or `'owner'` or both for org admins.
   - Recommendation: Planner reads `supabase/migrations/001_foundation.sql` and `046_org_invites.sql` to confirm before writing the RLS policy.

2. **Unique constraints on `contact_tags` and `opportunity_contacts`.**
   - What we know: They look like join tables; CASCADE-on-delete strongly suggests composite uniqueness.
   - What's unclear: Exact composite column lists.
   - Recommendation: Planner reads `supabase/migrations/060_tags_system.sql` and `1039_opportunity_contacts.sql` to confirm `INSERT...ON CONFLICT` target columns.

3. **Library-layer write sites (webhook/automation paths) integration of `resolveLiveContactId`.**
   - What we know: 12 files in `src/lib/**` reference `contact_id` writes.
   - What's unclear: Which of these are user-input paths vs. always-creates-contact paths.
   - Recommendation: Plan a follow-up task in Phase 106 (or defer to Phase 110) to audit each `src/lib` write site. For Phase 106's PR, ship the 7 dashboard server-action wraps and leave library paths for a tracked TODO.

4. **Sidebar icon for "Conflicts" nav item.**
   - What we know: Existing sidebar uses lucide-react icons.
   - What's unclear: Best icon — `GitMerge`, `Users`, `AlertCircle`, `Copy`?
   - Recommendation: `GitMerge` (semantic match) or `Users` (matches "Contacts" parent theming). Defer to planner / UI taste.

5. **Whether the conflicts page should be `/admin/contacts/conflicts` or nested under a `/admin/contacts` index.**
   - What we know: D-05 specifies the route.
   - What's unclear: Should there also be a `/admin/contacts` index page?
   - Recommendation: Just `/admin/contacts/conflicts` for Phase 106. No index page needed today.

## Sources

### Primary (HIGH confidence)

- Prod DB introspection via `db-query.mjs` (2026-05-25): FK enumeration, contact_id column survey, ghl_events type check, Postgres version. Project `mwklvkmggmsintqcqfvu`.
- `supabase/migrations/1056_contact_identity_audit.sql` — Phase 105 schema (read in full).
- `src/app/(admin)/layout.tsx:7-10` — auth gate pattern.
- `src/app/(admin)/admin/_actions/landing-config.ts:16-21` — `assertAdmin()` canonical pattern.
- `src/components/admin/admin-sidebar.tsx:22-30` — nav items array.
- `src/lib/supabase/server.ts:10-40` — cached client.
- `src/components/ui/` glob — confirmed Card, Button, Dialog, AlertDialog, Badge, Skeleton present.
- `supabase/migrations/` glob — confirmed 1056 is highest; next is 1057.
- `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/105-AUDIT-BASELINE.md` — 0 clusters, 1 contact.
- `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/106-CONTEXT.md` — D-01..D-05 locked decisions.
- `.planning/workstreams/v30-contact-identity/ROADMAP.md` — phase scope.

### Secondary (MEDIUM confidence)

- Server-action grep results across `src/app/(dashboard)/**/_actions/` and `src/lib/**` — file list verified; specific line numbers spot-checked for chat/contacts/pipeline/bookings.

### Tertiary (LOW confidence)

- Exact column names on `contact_tags` and `opportunity_contacts` (assumed `org_id, contact_id, tag_id` and `org_id, opportunity_id, contact_id, is_primary` from spot-checks in `pipeline/actions.ts:526-530`; not directly read from migration files in this research pass — planner should verify).
- `org_memberships.role` values — known to include `'admin'` from D-03c but full enum not directly inspected.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified present in repo.
- FK enumeration: HIGH — direct prod query.
- Architecture: HIGH — admin pattern is canonical and copied from existing landing-config action.
- Pitfalls: HIGH — all 12 derive from concrete schema facts (CHECK constraints, UNIQUE on join tables, generated columns, FK type).
- Test plan: MEDIUM — Vitest assumed but config file not directly opened; planner should confirm.

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (30 days — schema is stable, no fast-moving deps)

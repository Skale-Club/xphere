# Phase 106: MERGE-TOOL - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin UI + DB function to review and resolve duplicate contact clusters detected by `contact_duplicate_audit` (built in Phase 105). Survivor keeps its id; archived rows get `identity_status='archived_duplicate'` plus `merged_into_contact_id` FK. All foreign keys pointing at archived contacts get rewritten to the survivor in a single transaction.

Delivers:
- Migration 1057: `contact_merge_exclusions` table, `contact_merge_log` table, `merged_into_contact_id` column on `contacts`, `merge_contacts(survivor, archived)` SECURITY DEFINER SQL function, updated `refresh_contact_duplicate_audit()` to exclude excluded pairs
- `/admin/contacts/conflicts` admin page (super_admin only) that lists clusters and lets a human pick survivor + merge or mark-as-separate
- `resolveLiveContactId(contact_id)` helper for app-layer writes to silently follow `merged_into_contact_id`
- Banner UI on archived contact detail pages — "this contact was merged into X"
- Phase 106 ships even though baseline shows 0 clusters today — Phase 107 (UNIQUE constraints) gates on this UI existing and being operational, not on having data to feed it

Does NOT deliver (deferred):
- Auto-merge of exact-match duplicates (deferred per D-01 — Phase 106.1 or 110)
- UNIQUE constraints (Phase 107)
- Channel identities table (Phase 108)
- Identity trigger (Phase 109)
- Verified state, conflict banner in contact list, placeholder email rejection (Phase 110)

</domain>

<decisions>
## Implementation Decisions

### Auto-merge Scope
- **D-01:** Auto-merge is **deferred** from this phase. Phase 106 ships manual-only. Reason: Phase 105 baseline showed 0 duplicate clusters in prod, so auto-merge rules cannot be validated against real data. When duplicates start appearing organically (via webhook contact creation, CSV imports, etc.), Phase 106.1 or a later phase will design the auto-merge rules around the real failure modes observed.
- **D-01a:** ROADMAP Phase 106 success criterion #5 (Auto-merge mode) is rescinded for this phase. Updated success criteria are #1, #2, #3, #4, #6, #7 (six instead of seven).

### FK Rewrite Strategy
- **D-02:** SQL function `merge_contacts(survivor_id uuid, archived_id uuid)` SECURITY DEFINER, defined in migration 1057. Body contains explicit `UPDATE <table> SET contact_id = survivor_id WHERE contact_id = archived_id` for every table that references `contacts.id`. **No** generic helper, **no** ON UPDATE CASCADE chains, **no** dynamic SQL.
- **D-02a:** Function wraps all UPDATEs in a single implicit transaction (function body is one transaction). Either all FKs rewrite or none do.
- **D-02b:** Function also marks the archived row: `UPDATE contacts SET identity_status='archived_duplicate', merged_into_contact_id=survivor_id, updated_at=now() WHERE id=archived_id`.
- **D-02c:** Function inserts an audit row in `contact_merge_log` before committing (timestamp, survivor, archived, merged_by from `auth.uid()`, strategy='manual').
- **D-02d:** Function returns void. App reads `contact_merge_log` for confirmation.
- **D-02e:** Researcher must enumerate every table with a `contact_id` FK (planner-task work). Expected list (preliminary): `conversations`, `messages`, `calls`, `opportunities`, `tasks`, `notes`, `contact_imports`, `contact_import_errors`, `custom_field_values` (if it scopes by contact). Validation: `SELECT conrelid::regclass FROM pg_constraint WHERE confrelid='public.contacts'::regclass AND contype='f'`.

### "Mark as Separate" Semantics
- **D-03:** New table `contact_merge_exclusions (org_id uuid NOT NULL, contact_id_a uuid NOT NULL, contact_id_b uuid NOT NULL, excluded_by uuid REFERENCES auth.users(id), excluded_at timestamptz DEFAULT now(), reason text, PRIMARY KEY (org_id, contact_id_a, contact_id_b), CHECK (contact_id_a < contact_id_b))`.
- **D-03a:** The `a < b` CHECK enforces canonical ordering so the same pair cannot be inserted twice in different orders.
- **D-03b:** `refresh_contact_duplicate_audit()` (created in Phase 105) is **updated** in migration 1057 to exclude clusters where all pairwise combinations of `contact_ids` are present in `contact_merge_exclusions`. If even one pair in the cluster is not excluded, the cluster still appears in the audit (partial exclusion does not hide the cluster).
- **D-03c:** RLS: org admins (`role='admin'` in `org_memberships`) can insert/select rows in `contact_merge_exclusions`. Service role bypasses.

### merged_into FK App Behavior
- **D-04:** Three behaviors by call site:
  1. **Read paths (contact detail page, contact list):** Allow loading archived contact. Show banner `"This contact was merged into <name>"` with link to survivor. Detail page returns 200, not 404.
  2. **Write paths (create message, booking, opportunity, etc.):** Helper `resolveLiveContactId(contact_id)` in `src/lib/contacts/server.ts`. If contact has `identity_status='archived_duplicate'`, returns `merged_into_contact_id`. Otherwise returns input unchanged. All server actions that mutate state must call this helper before the contact_id touches a write.
  3. **Lookup paths (find_contact_by_phone, find_contact_by_email):** SQL adds `WHERE identity_status <> 'archived_duplicate'` filter. Archived contacts are invisible to lookups. New activity always flows to survivors.
- **D-04a:** `merged_into_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL` — column nullable, FK self-reference. Survivor's own row has `merged_into_contact_id=NULL`.
- **D-04b:** Banner component lives at `src/components/contacts/merged-banner.tsx`. Used on both contact detail page and any other page that may show an archived contact (e.g., conversation participant info).

### Admin UI Scope
- **D-05:** `/admin/contacts/conflicts` route (under existing `/admin` admin shell). Access: super_admin only (existing auth gate pattern).
- **D-05a:** Page lists clusters from `contact_duplicate_audit` ordered by `cluster_size DESC, detected_at ASC`.
- **D-05b:** Per cluster: side-by-side contact cards (up to N=10 contacts per cluster, paginate if more). Each card shows: name, phone (raw + normalized), email (raw + normalized), source, created_at, conversation count, message count.
- **D-05c:** Actions per cluster: "Merge into A / B / C…" button per contact (picks survivor), then a confirm modal. "Mark as separate" button at cluster level (adds all pairwise combinations to `contact_merge_exclusions`).
- **D-05d:** "Refresh audit" button at top of page invokes `refresh_contact_duplicate_audit()` server-side and reloads.

### Claude's Discretion
- Exact migration filename (1057_xxx.sql — name picked at planning time).
- Specific React Server Component vs client component split for the conflicts page.
- Pagination strategy for large clusters (unlikely given 0 baseline, but plan should handle it).
- Whether to add a `WHERE archived_at IS NULL` filter to the audit refresh (probably yes for performance once data exists).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 105 Output (binding)
- `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/105-CONTEXT.md` — D-01..D-04 still locked, especially the 5-value CHECK on `identity_status`.
- `.planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/105-AUDIT-BASELINE.md` — proves prod has 1 contact, 0 clusters. Drives the D-01 auto-merge defer.
- `supabase/migrations/1056_contact_identity_audit.sql` — schema this phase extends.

### Roadmap & Project
- `.planning/workstreams/v30-contact-identity/ROADMAP.md` — Phase 106 success criteria (note: #5 rescinded per D-01a).
- `.planning/PROJECT.md` — multi-tenant invariants, RLS via `get_current_org_id()`.

### Repo Files Researcher Must Inspect
- All migrations under `supabase/migrations/` — enumerate every table with `contact_id` FK to `contacts.id` (drives D-02 explicit UPDATE list).
- `src/lib/supabase/server.ts` — service role client pattern, `createClient()` cached helper.
- `src/lib/auth.ts` and `src/middleware.ts` (if present) — super_admin gate pattern for `/admin` routes.
- `src/app/(admin)/` — existing admin pages layout, sidebar component.
- `src/app/(dashboard)/contacts/page.tsx` and `src/app/(dashboard)/contacts/[id]/page.tsx` — current contact pages to understand where the banner needs to render.
- `src/components/admin/orgs-table.tsx`, `src/components/admin/org-detail-view.tsx` — admin component patterns to mirror.
- `src/lib/contacts/zod-schemas.ts` and `src/app/(dashboard)/contacts/actions.ts` — existing contact server actions to wire `resolveLiveContactId` into.
- `src/types/database.ts` — has `ContactIdentityStatus` and `contact_duplicate_audit` types (added Phase 105). Will need updates for `contact_merge_log`, `contact_merge_exclusions`, and `contacts.merged_into_contact_id`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`/admin` route group** — Existing admin shell with sidebar, auth gate. Already used for orgs, activity, traffic, seo, landing, platform settings. Mirror this for `/admin/contacts/conflicts`.
- **`mcp__supabase_mcp_xphere__execute_sql`** — Not viable (MCP points at wrong project — known from Phase 105). Stick with `pg` client via `db-query.mjs` for ad-hoc, app uses Supabase JS client via existing helpers.
- **shadcn/ui** primitives (Card, Button, Dialog, Badge) for the side-by-side contact cards.
- **`refresh_contact_duplicate_audit()`** — created Phase 105, used as-is. Migration 1057 only extends it (drop+recreate with exclusion filter, or add a CTE; planner decides).
- **`contact_duplicate_audit` table** — Phase 106 reads, never writes directly. Writes happen via `refresh_contact_duplicate_audit()`.

### Established Patterns
- **Server actions** in `src/app/(dashboard)/*/_actions/` or `src/app/(admin)/*/_actions/`. Phase 106 follows this for `mergeContacts(survivorId, archivedIds[])` and `markAsSeparate(clusterId, contactIds[])`.
- **RLS first, then server check** — every page server-side renders auth check via `getUser()` + role check before SQL queries.
- **`sonner`** for toast notifications post-merge.
- **`react-hook-form` + `zod`** is NOT needed here — the merge UI is mostly click-driven, not form-driven.

### Integration Points
- `src/lib/contacts/server.ts` (new file) — central place for `resolveLiveContactId` and any other identity-aware helpers.
- Server actions that currently take `contact_id` and write: `createMessage`, `createCall`, `createOpportunity`, `createBooking`, `createTask`, `createNote`, etc. Each must call `resolveLiveContactId()` before persisting. Researcher must enumerate full list.
- Contact detail page: `src/app/(dashboard)/contacts/[id]/page.tsx` — render banner when `identity_status='archived_duplicate'`.

</code_context>

<specifics>
## Specific Ideas

- Cluster card layout: 2-3 columns of contact cards side-by-side (responsive), "Merge into this one" button on each card, "Mark as separate" button as a footer action on the cluster.
- Merge modal: shows "You're about to merge X (archived) into Y (survivor). All conversations, messages, calls, opportunities, tasks, notes will be reattributed to Y. This action is recorded in the audit log. Continue?" with explicit confirm button.
- After merge: toast "Merged. <link to cluster list>" and the cluster disappears from the page on next refresh.
- After mark-as-separate: toast "These contacts will not appear as duplicates in future audits. Undo via contact_merge_exclusions table."

</specifics>

<deferred>
## Deferred Ideas

- **Auto-merge of exact-match duplicates** — Phase 106.1 or part of Phase 110 (D-01 defer). Wait until real duplicates appear to design the rules.
- **Bulk merge UI** — process multiple clusters at once. Not needed at cluster count = 0; add when meaningful clusters appear.
- **Undo merge** — would need to restore FK rewrites + reset `identity_status`. Complex. Skip unless requested.
- **Merge from contact detail page** — Today, merge is only from `/admin/contacts/conflicts`. Inline merge from contact detail is a future ergonomic improvement.
- **Notification to org members** — Notify when admin merges contacts in their org. Phase 110.
- **Webhook on merge** — Emit `contact.merged` workflow event. Phase 110 or workflow runtime hardening.
- **Soft-delete of archived contacts after N days** — Currently archived rows stay forever. Retention policy is org-settings work in a future milestone.

</deferred>

---

*Phase: 106-merge-tool*
*Context gathered: 2026-05-25*

# Phase 105: AUDIT-GENERATED-COLUMNS - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Audit existing duplicate contacts and add normalization infrastructure to `contacts` without breaking anything.

Delivers:
- `phone_e164` and `email_normalized` generated columns on `contacts`
- `identity_status` enum column on `contacts` with per-row backfill
- `normalize_phone()` SQL function
- Persistent `contact_duplicate_audit` table with re-runnable view
- Backfill that classifies existing rows correctly

Does NOT deliver (future phases):
- UNIQUE constraints (Phase 107)
- Merge UI (Phase 106)
- `contact_channel_identities` table (Phase 108)
- Identity trigger (Phase 109)
- Verified state, conflict UI (Phase 110)

</domain>

<decisions>
## Implementation Decisions

### Audit Output Format
- **D-01:** Persist audit results in table `contact_duplicate_audit` with columns: `cluster_id uuid`, `org_id uuid`, `match_type text CHECK (match_type IN ('phone','email'))`, `normalized_value text`, `contact_ids uuid[]`, `cluster_size int`, `detected_at timestamptz`. Re-runnable via SQL function `refresh_contact_duplicate_audit()`. No admin UI in this phase — that ships in Phase 106.

### Phone Normalization
- **D-02:** `normalize_phone(input text) RETURNS text` does minimal work: strip everything except digits, preserve a single leading `+` if present, return NULL on empty. Function is IMMUTABLE so it can power generated columns.
- **D-02a:** Validation of impossible numbers stays in the app layer (`react-international-phone` + Zod refine in `src/lib/contacts/zod-schemas.ts`). DB does not validate — it normalizes whatever is stored.
- **D-02b:** Email normalization is inline `lower(trim(coalesce(email,''))) NULLIF ''` in the generated column definition — no separate function needed.

### identity_status Backfill
- **D-03:** Per-row backfill (not blanket default):
  - `channel_only` when `phone IS NULL AND email IS NULL AND source IN ('instagram','whatsapp','facebook','messenger') AND external_id IS NOT NULL`
  - `identified` for everything else
- **D-03a:** Future statuses (`verified`, `merge_conflict`, `archived_duplicate`) reserved but not assigned in this phase — only `channel_only` and `identified` appear post-backfill.
- **D-03b:** CHECK constraint enumerates all 5 future values now, even though only 2 are used, to avoid re-altering the constraint in later phases.

### Migration Approach
- **D-04:** Apply migration via Supabase branch first (`mcp__supabase_mcp_xphere__create_branch` or CLI). On branch: run migration → run audit refresh → inspect for parse errors → if clean, merge branch back to main. Do not apply directly to remote prod.
- **D-04a:** Migration file naming continues 0xx sequence. Next number is determined at planning time by listing `supabase/migrations/`.

### Claude's Discretion
- TypeScript type regeneration approach (`src/types/database.ts`) — Claude picks between `mcp__supabase_mcp_xphere__generate_typescript_types` MCP call vs hand-edit.
- Exact placement of `normalize_phone()` in migration file (single file vs split).
- Whether to add a `contact_duplicate_audit_id` reverse FK on `contacts` (probably no — clusters reference contacts, not vice versa).
- Index strategy on `contact_duplicate_audit` for Phase 106 query patterns.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture Source
- Notion page (external, not in repo): https://www.notion.so/36bb7a68612181a4a124c5b92d12c904 — original "Contact Identity — Phone & Email Uniqueness Architecture" project; this phase implements the slimmed counterproposal, not the polymorphic identity table.

### Project Roadmap
- `.planning/workstreams/v30-contact-identity/ROADMAP.md` — full 6-phase plan with success criteria per phase.

### Repo Files To Read Before Planning
- `supabase/migrations/051_contacts.sql` — current `contacts` table definition, indexes on phone/email (NOT unique), source enum.
- `supabase/migrations/066_contact_imports.sql` — existing dedup behavior in CSV import (dedup_keys + dedup_strategy).
- `src/lib/contacts/zod-schemas.ts` — current TS normalization functions (`normalisePhone`, `normaliseEmail`); the SQL `normalize_phone()` must produce IDENTICAL output for the same input.
- `src/app/(dashboard)/contacts/actions.ts:412-427` — current race-prone dedup logic in `createContact`; not modified in this phase but referenced by Phase 107.
- `src/lib/meta/process-event.ts:945-986` — `linkConversationsToContacts` does post-hoc phone matching; touched in Phase 108.
- `src/types/database.ts:1620-1639` — `ContactRow` type; will need regen after migration.
- `src/components/ui/phone-input.tsx` — confirms E.164 storage convention from UI side.
- `CLAUDE.md` — Xphere project conventions: `npm run build` mandatory, multi-tenant RLS via `get_current_org_id()`, never edit old migrations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`normalisePhone`/`normaliseEmail`** (`src/lib/contacts/zod-schemas.ts:20-34`): TS logic to mirror in SQL. SQL `normalize_phone()` semantics: strip non-digits, preserve single leading `+`. Email normalization: `lower(trim(x))`.
- **`get_current_org_id()`** SECURITY DEFINER function: use in RLS policies on new `contact_duplicate_audit` table.
- **Supabase MCP tools** (`mcp__supabase_mcp_xphere__*`): use `create_branch` for safe migration testing, `apply_migration` for execution, `generate_typescript_types` for ContactRow regen.

### Established Patterns
- **Migrations:** Numbered SQL files in `supabase/migrations/`, never edit old ones. Next number after 072 (assumed — verify at planning time).
- **RLS:** Every new table gets `ENABLE ROW LEVEL SECURITY` + policy scoped to `get_current_org_id()`. Service role bypasses for backfill scripts.
- **Generated columns:** Not yet used in xphere migrations (verify) — this phase introduces the pattern. Standard: `GENERATED ALWAYS AS (expr) STORED`.

### Integration Points
- `contacts` table is referenced by ~10+ tables (conversations, messages, calls, opportunities, tasks, notes, contact_imports, etc.). This phase only ADDS columns — no FK changes. Safe.
- No app code paths need to change in this phase. `createContact`, webhooks, imports continue to write to `phone`/`email` and the generated columns populate automatically.

</code_context>

<specifics>
## Specific Ideas

- Counterproposal vs Notion architecture: explicitly NOT using polymorphic `contact_identities` table. Phone/email stay as columns on `contacts`. Channel identities get their own table in Phase 108, not this one.
- Org-scoped uniqueness is non-negotiable for the project (multi-tenant) but not enforced until Phase 107.
- Branch isolation: Supabase branching used for migration validation, not for app code. App code is on git branch `feat/contact-identity`.

</specifics>

<deferred>
## Deferred Ideas

- **Merge UI / conflict resolution:** Phase 106.
- **`UNIQUE (org_id, phone_e164)` partial index:** Phase 107. Cannot be added until duplicates are resolved in Phase 106.
- **`contact_channel_identities` table:** Phase 108.
- **Identity invariant trigger (must have phone OR email OR channel):** Phase 109.
- **`verified` state, email link click verification, SMS reply-yes:** Phase 110.
- **Placeholder email rejection (`noemail@*`, `test@test.com`):** Phase 110, configurable via `org_settings.blocked_email_patterns`.
- **CSV import dedup integration with new normalized columns:** Phase 110.
- **Removal of `contacts.source` column:** Phase 110 (data moves to `contact_channel_identities` in Phase 108).
- **libphonenumber / strict E.164 validation in DB:** rejected (app layer handles), do not revisit unless production data shows the simple normalizer producing collisions.

</deferred>

---

*Phase: 105-audit-generated-columns*
*Context gathered: 2026-05-25*

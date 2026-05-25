# Phase 105: AUDIT-GENERATED-COLUMNS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 105-audit-generated-columns
**Areas discussed:** Audit output format, Phone normalization rigor, identity_status default, Migration approach

---

## Area Selection

User was asked to multi-select which gray areas to discuss. User replied "faca tudo recomendado" — interpret as: discuss all four areas, pick the recommended option for each.

| Area Offered | Selected | Resolution |
|--------------|----------|------------|
| Audit output format | ✓ | Recommended: persistent table |
| Phone normalization rigor | ✓ | Recommended: simple SQL normalizer, validation in app |
| identity_status default for existing rows | ✓ | Recommended: per-row logic during backfill |
| Migration approach | ✓ | Recommended: Supabase branch first |

---

## Audit Output Format

| Option | Description | Selected |
|--------|-------------|----------|
| SQL script ad-hoc | One-off query, results to stdout. Not re-runnable cleanly. | |
| Persistent table `contact_duplicate_audit` + refresh function | Re-runnable, queryable, feeds Phase 106 UI directly. | ✓ |
| `/admin/contacts/duplicates` endpoint | UI in this phase. Mixes audit infra with admin UI work. | |

**User's choice:** Recommended (persistent table).
**Rationale:** Phase 106 needs to query duplicate clusters from app code — having them in a table makes that trivial. Refresh function lets it re-run after merges in Phase 106 to verify cluster count reaches zero (gate for Phase 107).

---

## Phone Normalization Rigor

| Option | Description | Selected |
|--------|-------------|----------|
| Simple SQL normalize_phone (strip non-digits, preserve `+`) | Mirrors current TS `normalisePhone` exactly. Idempotent, IMMUTABLE, fast. | ✓ |
| libphonenumber via PG extension | Strict E.164 validation, country-aware. Heavy. Extension may not be available on Supabase. | |
| App-only normalization, no SQL function | Generated columns can't reference app code. Would force trigger-based approach. Worse. | |

**User's choice:** Recommended (simple SQL).
**Rationale:** UI already enforces structure via `react-international-phone` + Zod. DB function just needs to produce a consistent comparable string. App layer remains the source of truth for "is this a valid phone".

---

## identity_status Default for Existing Rows

| Option | Description | Selected |
|--------|-------------|----------|
| Blanket default 'identified' | Simple migration. Wrong for ~N% of rows (channel-only Instagram leads). Requires cleanup later. | |
| Per-row backfill logic | More complex migration. Correct from day one. | ✓ |
| Leave NULL, decide later | Pushes the problem to a future migration. Bad. | |

**User's choice:** Recommended (per-row).
**Rationale:** Rule: `channel_only` when `phone IS NULL AND email IS NULL AND source IN (channel sources) AND external_id IS NOT NULL`. `identified` otherwise. Done in same migration, single transaction. Phase 109 will enforce the invariant via trigger — having correct status from start avoids retro-fixing.

---

## Migration Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Apply directly via `supabase db push` | Fast, what CLAUDE.md describes. Risky on a schema migration touching all contacts. | |
| Supabase branch first, then promote | Slower setup. Validates generated column expressions don't error on prod-shaped data before touching prod. | ✓ |
| Local supabase only, deploy manually later | Doesn't validate against real org data. | |

**User's choice:** Recommended (branch first).
**Rationale:** Generated columns are STORED — backfill happens at ALTER TABLE time. If `normalize_phone()` errors on any existing row, the migration fails mid-transaction. Branch lets us catch that before prod.

---

## Claude's Discretion

- TypeScript type regeneration: MCP `generate_typescript_types` call after migration succeeds.
- Migration file structure: single file containing function + columns + backfill + audit table. Splitting adds rollback complexity without benefit.
- `contact_duplicate_audit` index strategy: defer to planning step.

## Deferred Ideas

None surfaced during discussion. All scope was on-target.

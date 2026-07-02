# Phase 120: Publish Lifecycle - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** mostly code + one tiny idempotent normalization migration (file, not applied). Verify via `npm run build` (+ optional action logic test).

<domain>
## Phase Boundary
Expose a coherent draft ↔ published lifecycle for email templates and FIX the status-vocabulary inconsistency. The `email_templates.status` column already exists (text, default 'draft'; migration 072 commented it 'draft'|'ready'|'archived', but the list UI's `STATUS_CLASSES` expects 'published'). Standardize to **draft | published | archived**. Add publish/unpublish from the editor toolbar and the list card. Publishing refreshes the HTML snapshot.
</domain>

<decisions>
## Implementation Decisions

### Vocabulary reconciliation (draft | published | archived)
- `src/app/(dashboard)/settings/email-templates/page.tsx`: `STATUS_CLASSES` covers draft/published/archived; the stats bar already counts draft + published — keep. Treat any legacy `'ready'` as `'published'` in display (map it) so old rows don't render blank.
- `createTemplate` default stays `'draft'`.

### Publish/unpublish server actions — `src/app/(dashboard)/email-templates/actions.ts`
- Add `publishTemplate(id)` → set `status: 'published'` AND refresh `html_snapshot`/`plain_text_snapshot` via `renderTemplate(document)` (so the published snapshot is current); revalidate paths. Optional light pre-publish validation (non-empty document; a subject/name present) returning `{ ok:false, error }` if it fails.
- Add `unpublishTemplate(id)` → set `status: 'draft'`.
- (Optional) `archiveTemplate(id)` → `status:'archived'` if trivial; else defer.

### UI
- Editor toolbar (`email-template-editor.tsx`): a Publish button (when draft) / Unpublish (when published), calling the actions; reflect the new status without a full reload (optimistic or router.refresh).
- List card (`settings/email-templates/page.tsx` via `TemplateListActions` or inline): a Publish/Unpublish quick action; the Badge already shows `template.status`.

### Migration (tiny, idempotent — write as file, do NOT apply; tip 1228 → `1229_normalize_email_template_status.sql`)
```sql
-- migration 1229: normalize legacy email_templates.status 'ready' -> 'published' (Phase 120, UFE-09)
update public.email_templates set status = 'published' where status = 'ready';
```
Append a 1229 entry to PENDING-MIGRATIONS.md (apply anytime after 1228; LOW risk — data normalization; may affect 0 rows). Code also maps 'ready'→published defensively so applying is not strictly required for correctness.

### Verification
- `npm run build` exit 0. Optionally a small action/test for `publishTemplate` snapshot-refresh logic if it factors cleanly. Runtime click-through is post-migration-apply human-verify (list/editor nest under the folder-querying layout).
</decisions>

<code_context>
## Existing Code Insights
- `src/app/(dashboard)/settings/email-templates/page.tsx` — `STATUS_CLASSES` map, stats bar, Badge showing `template.status`, `TemplateListActions`.
- `src/app/(dashboard)/email-templates/actions.ts` — `saveTemplate` already renders + stores `html_snapshot`/`plain_text_snapshot` via `renderTemplate`; mirror that in `publishTemplate`. `createTemplate` default 'draft'.
- `src/app/(dashboard)/email-templates/_components/email-template-editor.tsx` — toolbar (Settings/Reusable/Preview/Save) to add Publish/Unpublish; `TemplateListActions` in `_components/template-list-actions.tsx` for the list card action.
- `src/lib/email/render-template.ts` — `renderTemplate(document)` → { html, plainText }.
</code_context>

<specifics>
## Specific Ideas
- Single status scheme end to end: draft | published (| archived). No `'ready'` anywhere new; only the defensive legacy map.
- Publishing MUST refresh the snapshot (so the published HTML matches the current document).
</specifics>

<deferred>
## Deferred Ideas
- Sending integration (merge-tags, send_email_template tool, campaign selection) → Phase 121.
- Runtime click-through verification → post-migration-apply.
</deferred>

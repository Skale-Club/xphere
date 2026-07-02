---
phase: 120-publish-lifecycle
plan: 01
subsystem: email-templates
tags: [email-templates, publish-lifecycle, status-vocabulary, server-actions, migration]
requires:
  - "email_templates.status column (default 'draft')"
  - "renderTemplate(document) -> { html, plainText } from src/lib/email/render-template.ts"
  - "EmailTemplateBuilderRow.status (plain string)"
provides:
  - "publishTemplate(id) server action — status='published' + snapshot refresh + light validation"
  - "unpublishTemplate(id) server action — status='draft'"
  - "STATUS_CLASSES draft|published|archived + displayStatus legacy 'ready'->'published' map"
  - "Publish/Unpublish UI in editor toolbar and list card"
  - "migration 1229 (file-only) normalizing legacy 'ready' -> 'published'"
affects:
  - "src/app/(dashboard)/settings/email-templates (list card + badge)"
  - "src/app/(dashboard)/email-templates/[id] editor (toolbar)"
tech-stack:
  added: []
  patterns:
    - "Publish action mirrors saveTemplate's renderTemplate snapshot write"
    - "Runtime status reconciliation (no TS union) via a display normalizer + class map"
    - "Local status state in editor flips button without a full reload; list card uses router.refresh()"
key-files:
  created:
    - supabase/migrations/1229_normalize_email_template_status.sql
  modified:
    - src/app/(dashboard)/email-templates/actions.ts
    - src/app/(dashboard)/settings/email-templates/page.tsx
    - src/app/(dashboard)/email-templates/_components/template-list-actions.tsx
    - src/app/(dashboard)/email-templates/_components/email-template-editor.tsx
    - .planning/workstreams/v32-universal-folders-email-templates/PENDING-MIGRATIONS.md
decisions:
  - "Standardize on draft | published | archived; map legacy 'ready' -> 'published' defensively in display so applying migration 1229 is a cleanup, not a correctness gate"
  - "publishTemplate re-reads the STORED document (not the editor's unsaved doc) to refresh the snapshot — Save persists edits, Publish flips status + refreshes snapshot from what's stored (intentional for this phase)"
  - "createTemplate default stays 'draft' (unchanged)"
  - "Migration 1229 written as a FILE only, not applied (CODE-ONLY mode; DB writes gated); ledgered as LOW risk"
metrics:
  duration: ~6m
  completed: 2026-07-02
  tasks: 3
  files: 5
  commits: 3
---

# Phase 120 Plan 01: Publish Lifecycle Summary

Exposed a coherent draft ↔ published lifecycle for email templates and reconciled the status vocabulary to **draft | published | archived** (legacy `'ready'` mapped to `'published'` at display time), with `publishTemplate`/`unpublishTemplate` server actions (publish refreshes the HTML snapshot) surfaced in both the editor toolbar and the list card.

## What Was Built

- **`publishTemplate(id)`** (`email-templates/actions.ts`): loads the stored `name` + `document`, runs light pre-publish validation (non-empty trimmed name; at least one section), refreshes `html_snapshot`/`plain_text_snapshot` via `renderTemplate(doc)` (mirroring `saveTemplate`), sets `status: 'published'`, and revalidates both the `/email-templates` and `/settings/email-templates` paths (list + `[id]`).
- **`unpublishTemplate(id)`**: sets `status: 'draft'` and revalidates the same paths.
- **`getTemplate` select**: already contained `status` (verified) — no change needed, so the editor can read `template.status` for the initial toggle state.
- **`STATUS_CLASSES`** (`settings/email-templates/page.tsx`): extended to cover `archived`; added a `displayStatus()` helper mapping legacy `'ready'` → `'published'`. The Badge (class + label) now uses `displayStatus(template.status)`; `TemplateListActions` receives `status={displayStatus(template.status)}`.
- **`TemplateListActions`**: gained a `status: string` prop and a Publish (Send icon) / Unpublish (Undo2 icon) quick action as the first button in the row, calling the actions inside `startTransition` + `router.refresh()`.
- **Editor toolbar** (`email-template-editor.tsx`): a Publish/Unpublish `outline` button placed just before Save, backed by a local `status` state (`useState(template.status)`) so the button flips immediately without a full reload.
- **Migration `1229_normalize_email_template_status.sql`** (FILE ONLY, not applied): idempotent `update ... set status='published' where status='ready'`. Appended to `PENDING-MIGRATIONS.md` as item 5 (LOW risk).

## Verification

- `npm run build` exit 0 (type check + production build) after Task 1 and again after Task 3.
- Acceptance greps confirmed: `publishTemplate`/`unpublishTemplate` exported; `renderTemplate` appears 3× in actions.ts (import + saveTemplate + publishTemplate); `STATUS_CLASSES` covers `archived`; `displayStatus` maps `'ready'`; both the list card and editor toolbar reference `publishTemplate`/`unpublishTemplate` and render "Publish".
- Migration file exists and contains `where status = 'ready'`; ledger item 5 present with **Risk:** LOW.
- Runtime click-through (publish from list/editor, badge consistency) is a deferred post-migration human-verify — the email-templates routes nest under the folder-querying layout, which needs migrations 1225/1226/1227/1228 applied first.

## Deviations from Plan

None — plan executed as written.

- Edit A of Task 1 (add `status` to `getTemplate` select) was a verify-only step: `status` was already present in both `getTemplate` and `listTemplates` selects, so no change was made, exactly as the plan's "confirm by grep and move on" instruction anticipated.

## Notes / Follow-ups

- CODE-ONLY: migration 1229 is committed as a file and ledgered, NOT applied (`npx supabase db push` / `apply_migration` not run). Because the code also maps `'ready'` → published defensively, applying 1229 is a cleanup rather than a correctness requirement.
- Publishing from the editor refreshes the snapshot from the STORED document, not the editor's unsaved local `doc` — Save persists document edits, Publish flips status. Intentional for this phase.
- Unrelated pre-existing working-tree modifications (dashboard components, push-sender, next.config.ts, etc.) were present before this plan and left untouched — out of scope.

## Self-Check: PASSED

- All 6 key files present on disk (migration 1229, SUMMARY, actions.ts, page.tsx, template-list-actions.tsx, email-template-editor.tsx).
- All 3 task commits present: `37d4e294`, `49ebeeb0`, `8c7001bb`.

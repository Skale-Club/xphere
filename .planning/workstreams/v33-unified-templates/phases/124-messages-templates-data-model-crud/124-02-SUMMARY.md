---
phase: 124-messages-templates-data-model-crud
plan: 02
subsystem: ui
tags: [nextjs, react-hook-form, zod, radix-tabs, shadcn, server-actions]

# Dependency graph
requires:
  - phase: 124-messages-templates-data-model-crud (plan 01)
    provides: message_templates table + listMessageTemplates/getMessageTemplate/createMessageTemplate/updateMessageTemplate/deleteMessageTemplate server actions
provides:
  - "Full CRUD UI for Messages templates at /settings/message-templates (list, new, editor)"
  - "MessageTemplateEditor client component: name + default body + SMS/Email/WhatsApp override tabs via react-hook-form + zod"
  - "MessageTemplateListActions client component: AlertDialog delete confirmation"
  - "Settings sub-nav entry (Communications section) making the route reachable without typing the URL"
affects: [125-messages-preview-templates-nav-finalization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Flat, folder-less card-grid list page (no tree-nav sidebar), matching the plan's explicit no-folders decision for this template type"
    - "Delete-only list-actions component (no publish/duplicate) for template types without a status/approval concept"

key-files:
  created:
    - src/app/(dashboard)/settings/message-templates/page.tsx
    - src/app/(dashboard)/settings/message-templates/new/page.tsx
    - src/app/(dashboard)/settings/message-templates/[id]/page.tsx
    - src/app/(dashboard)/settings/message-templates/_components/message-template-editor.tsx
    - src/app/(dashboard)/settings/message-templates/_components/message-template-list-actions.tsx
  modified:
    - src/components/settings/settings-sub-nav.tsx

key-decisions:
  - "Inserted the 'Messages' nav entry between 'Email Templates' and 'WhatsApp Templates' (alphabetical-ish grouping) rather than at the end of the Communications items array — purely a placement choice, all three entries and the heading remain unchanged otherwise"
  - "Did not rename 'Communications' to 'Templates' — explicitly out of scope per plan and reserved for Phase 125 (NAV-03)"

patterns-established:
  - "Pattern: channel_overrides form fields (sms_override/email_override/whatsapp_override) are always-present zod string fields that get filtered to a sparse object (only non-empty keys) before being sent to the server action — keeps the form simple while preserving the optional-key JSONB contract from 124-01"

requirements-completed: [MSG-01, MSG-02, MSG-04]

# Metrics
duration: 22min
completed: 2026-07-03
---

# Phase 124 Plan 02: Messages Templates UI (List/Create/Edit) Summary

**Full CRUD UI for the Messages quick-reply template library at `/settings/message-templates` — card-grid list, name-only creation flow, and a tabbed SMS/Email/WhatsApp override editor — wired directly to the 124-01 server actions with a new Settings sub-nav entry.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-03T02:14:00Z
- **Completed:** 2026-07-03T02:36:00Z
- **Tasks:** 3 completed
- **Files modified:** 6 (5 new, 1 additive edit)

## Accomplishments
- `MessageTemplateEditor` renders name, required default-body textarea, and three optional tabbed override textareas (SMS/Email/WhatsApp) via `react-hook-form` + `zodResolver`, saving through `updateMessageTemplate`
- `MessageTemplateListActions` provides delete-only actions gated by an `AlertDialog` confirmation (no publish/duplicate/status UI, matching MSG-04's no-approval-workflow constraint)
- List page (`/settings/message-templates`) shows a card grid with name, truncated body preview, relative `updated_at`, and edit/delete actions, with an empty state when no templates exist
- New page (`/settings/message-templates/new`) collects only a name, creates via `createMessageTemplate`, and redirects straight to the editor
- Editor page (`/settings/message-templates/[id]`) is a server shell that fetches via `getMessageTemplate`, calls `notFound()` on a miss, and renders the client editor
- Settings sub-nav now has a "Messages" entry (MessagesSquare icon) under Communications, alongside Email Templates and WhatsApp Templates — the route is reachable without typing the URL
- `npm run build` passes with all three new route segments compiling cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Build editor form component and delete-action component** - `7f038409` (feat)
2. **Task 2: Build list, new, and editor routes** - `1a8bf55d` (feat)
3. **Task 3: Add Settings sub-nav entry for Messages templates** - `7ba4effd` (feat)

**Plan metadata:** (this commit) `docs: complete 124-02 plan`

## Files Created/Modified
- `src/app/(dashboard)/settings/message-templates/_components/message-template-editor.tsx` - Client form: name, default body, SMS/Email/WhatsApp override tabs, saves via `updateMessageTemplate`
- `src/app/(dashboard)/settings/message-templates/_components/message-template-list-actions.tsx` - Delete button with `AlertDialog` confirmation, calls `deleteMessageTemplate`
- `src/app/(dashboard)/settings/message-templates/page.tsx` - Server list page: header, empty state, card grid, auth-gated with `redirect('/')`
- `src/app/(dashboard)/settings/message-templates/new/page.tsx` - Client name-only creation form, redirects to editor on success
- `src/app/(dashboard)/settings/message-templates/[id]/page.tsx` - Server editor shell: fetches by id, `notFound()` on miss
- `src/components/settings/settings-sub-nav.tsx` - Added `MessagesSquare` import + "Messages" nav item under Communications

## Decisions Made
- Placed the new "Messages" nav item between "Email Templates" and "WhatsApp Templates" in the `items` array — no functional impact, just visual ordering; the plan's acceptance criteria only required the entry and heading to exist, not a specific array position
- Kept the "Communications" heading unchanged (not renamed to "Templates") per plan instruction — that rename is explicitly Phase 125's job (NAV-03)
- Followed the plan's provided code verbatim for all 6 files since it already matched established codebase conventions (react-hook-form + zodResolver, AlertDialog delete pattern, server-shell + client-editor split) verified against the actual 124-01 server-action signatures before writing

## Deviations from Plan

None - plan executed exactly as written. All code matched the plan's `<action>` blocks verbatim; only build-environment recovery was needed (see Issues Encountered), not code changes.

## Issues Encountered
- `npm run build` intermittently failed with `Another next build process is already running` even though no other build process was active — caused by a stale `.next/lock` file and, after removing it, a follow-up `ENOTEMPTY` error on `.next/diagnostics` from a previous build that didn't exit cleanly. Resolved by removing the stale lock file and then fully clearing the `.next` directory before rebuilding; the final `npm run build` for Task 2 and Task 3 each exited 0 with all three new route segments (`/settings/message-templates`, `/settings/message-templates/[id]`, `/settings/message-templates/new`) compiling successfully. This was a local build-cache artifact, not a code error, consistent with the concurrent-build-lock issue already noted in the 124-01 summary.

## User Setup Required

None - no external service configuration required for this plan's UI code. Carried over from 124-01: migration 1233 (`message_templates` table) still needs to be applied to the remote Supabase database (`npx supabase db push` or equivalent) before this UI will function against production — it was intentionally left as a code-only deliverable in 124-01 per CLAUDE.md sensitive-paths guidance.

## Next Phase Readiness
- Phase 125 (Messages Preview + Templates Nav Finalization) can now build the per-channel resolution preview (MSG-05) on top of the existing editor's default-body + override fields, and can safely rename "Communications" to "Templates" (NAV-03) since all three real entries (Email Templates, Messages, WhatsApp Templates) now exist under that heading
- Blocker/concern for the operator: migration 1233 is still not applied to the remote database (carried over from 124-01) — the Messages templates UI will fail at runtime against production until `npx supabase db push` is run

---
*Phase: 124-messages-templates-data-model-crud*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/settings/message-templates/_components/message-template-editor.tsx
- FOUND: src/app/(dashboard)/settings/message-templates/_components/message-template-list-actions.tsx
- FOUND: src/app/(dashboard)/settings/message-templates/page.tsx
- FOUND: src/app/(dashboard)/settings/message-templates/new/page.tsx
- FOUND: src/app/(dashboard)/settings/message-templates/[id]/page.tsx
- FOUND: src/components/settings/settings-sub-nav.tsx
- FOUND commit: 7f038409
- FOUND commit: 1a8bf55d
- FOUND commit: 7ba4effd

# Phase 124: Messages Templates Data Model + CRUD - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

A brand-new, org-scoped `message_templates` table plus full CRUD (create/list/edit/delete) at `/settings/message-templates`. This is a generic quick-reply template library — explicitly NOT a WhatsApp Business template (no approval workflow, free-form text, usable immediately). Per-channel resolution preview (MSG-05) and the Settings nav finalization (rename to "Templates") are OUT of scope here — they're Phase 125.

</domain>

<decisions>
## Data Model
- New table `message_templates`: `id uuid pk`, `org_id uuid` (FK to organizations, RLS-scoped like every other tenant table), `name text not null`, `body text not null` (the default body, plain text), `channel_overrides jsonb not null default '{}'` (optional per-channel overrides, e.g. `{"sms": "...", "email": "...", "whatsapp": "..."}` — keys are optional, a channel with no key falls back to `body`), `created_by`, `created_at`, `updated_at` (use the existing `update_updated_at()` trigger function established in the recent v3.2 migrations — NOT `moddatetime`, which isn't installed on prod per project history).
- `channel_overrides` uses a flexible JSONB shape (not fixed columns) so a future channel (e.g. push notifications) needs zero migration — just a new optional key. Mirrors the existing free-form JSONB pattern already used in `campaigns.template_config`.
- Standard RLS policy scoped to `org_id` via `get_current_org_id()`, matching every other tenant table in this project (see CLAUDE.md Multi-tenancy section).

## CRUD UI
- Dedicated route `/settings/message-templates` (list) + `/settings/message-templates/new` + `/settings/message-templates/[id]` (editor), mirroring the existing Email Templates route shape (`/settings/email-templates/[id]`) but WITHOUT the folder sub-sidebar/tree-nav — Messages templates are a flat list (no folders requested for this milestone).
- Editor page: one required "Default body" textarea (used for any channel without an override) + three optional tabbed panels — SMS / Email / WhatsApp — each with its own override textarea, defaulting to empty (meaning "use default body"). Tabs use whatever tab primitive already exists in this codebase's shadcn/ui set.
- List page: simple table/card list — name, truncated default body preview, updated_at, edit/delete actions. Delete needs a confirmation step (reuse whatever confirm-delete pattern email templates or another settings list already uses — do not invent a new one).
- No preview-what-resolves-per-channel UI yet — that's explicitly Phase 125 (MSG-05). This phase just needs the fields to exist and be editable/persistable.

## Claude's Discretion
Exact server-action file layout (mirror `email-templates/_actions/` conventions), exact zod validation shape, exact list page visual density — all at Claude's discretion, following established list-page conventions elsewhere in `/settings/*`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/types/database.ts` `email_templates` type — reference shape for how this project types a tenant CRUD table (though Messages templates do NOT need `folder_id`/`position`/`status`/`document`/`html_snapshot` — those are email-builder-specific; keep this table lean: name/body/channel_overrides only).
- Whatever confirm-delete dialog component the settings area already uses for destructive actions (grep for existing delete-confirmation modal/AlertDialog usage under `src/app/(dashboard)/settings/` before inventing one).

### Established Patterns
- `update_updated_at()` trigger function (established in migrations 1225+) — use this, not `moddatetime`.
- RLS via `get_current_org_id()` SECURITY DEFINER function — standard on every tenant table.
- Server actions as `'use server'` thin wrappers, Zod validation, `react-hook-form` + `zodResolver` on forms (per CLAUDE.md Components section).

### Integration Points
- None yet — this phase is a standalone new feature with its own route and table. No other module reads `message_templates` in this milestone (composer/campaign integration is explicitly deferred to backlog per REQUIREMENTS.md).

</code_context>

<specifics>
## Specific Ideas

`channel_overrides` keys are exactly `sms`, `email`, `whatsapp` (lowercase, matching the channel names used elsewhere in this codebase, e.g. `campaigns.channel` values) — pick whatever exact string values this codebase already uses for these three channels and match them (check `campaigns` table channel enum/values before hardcoding new ones).

</specifics>

<deferred>
## Deferred Ideas

- Per-channel resolution preview UI — Phase 125 (MSG-05).
- Using Messages templates as quick-insert in chat/inbox composer — backlog (REQUIREMENTS.md Future Requirements).
- Using Messages templates as SMS/WhatsApp campaign body — backlog (REQUIREMENTS.md Future Requirements).

</deferred>

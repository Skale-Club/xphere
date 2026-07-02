# Phase 117: Email Templates Sub-Sidebar + Folders - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** code-only (migration written as a committed FILE, NOT applied — PENDING-MIGRATIONS.md). Verification bar: `npm run build` exits 0.

<domain>
## Phase Boundary
Give **Email Templates** the same Workflows-style sub-sidebar with universal folders: templates organizable into folders (create/rename/color/icon/nest, drag templates between folders + reorder). Greenfield (no existing template folders). Reuse the already-generic `DraggableTreeNav` + `SubSidebarLayout` + `NewFolderButton`; do NOT rebuild them. entity_type='email_template', itemTable='email_templates', default folder column 'folder_id'.
</domain>

<decisions>
## Implementation Decisions

### Migration (write, do NOT apply; tip is 1227 → confirm with `ls supabase/migrations/ | sort | tail -3`, use `1228_email_templates_folders.sql`)
```sql
-- migration 1228: email_templates folder linkage (Phase 117, UFE-06)
alter table public.email_templates
  add column if not exists folder_id uuid references public.folders(id) on delete set null,
  add column if not exists position  integer not null default 0;
create index if not exists email_templates_folder_idx
  on public.email_templates (folder_id);
```
Append a `1228` entry to PENDING-MIGRATIONS.md (apply after 1227, before deploy; LOW risk — additive columns; verify: `select to_regclass('public.email_templates')` and column presence).

### Folder actions — `src/app/(dashboard)/email-templates/_actions/folders.ts` (new)
Thin `'use server'` wrappers over `@/lib/foldering/core`, ctx `{ supabase: await createClient(), entityType: 'email_template', itemTable: 'email_templates' }`, revalidating the templates path. Expose the full `TreeNavActions` contract: reorderFolders, deleteFolder(id,{cascadeChildren?}), renameFolder, updateFolderMeta, moveItemToFolder, reorderItemsInFolder, plus listFolders + createFolder. Mirror `src/app/(dashboard)/workflows/_actions/folders.ts` (post-115 core-delegation version).

### Sub-nav — `src/components/email-templates/email-template-sub-nav.tsx` (new)
Mirror `src/components/workflows/workflow-sub-nav.tsx`. Render `<DraggableTreeNav<EmailTemplateItem>>` with: `itemNoun="template"`, `getHref={(t) => '/settings/email-templates/' + t.id}`, `renderItemIcon` = a Mail lucide icon (or small html_snapshot thumb if trivial), `actions` = the new folder actions, `enableFolderIcon`, toolbar = New Template + New Folder buttons, footer optional, emptyState. Item type carries `{ id, name, group_id: folder_id }`.

### Layout — wrap the email-templates settings routes with `SubSidebarLayout`
Mirror `src/app/(dashboard)/workflows/layout.tsx`: fetch templates (existing `listTemplates()` + their `folder_id`) and folders (`.from('folders').eq('entity_type','email_template').order('position').order('created_at')`), map to nav shapes, render `<SubSidebarLayout storageKey="sub-sidebar:email-templates" title="Email Templates" nav={<EmailTemplateSubNav .../>} collapsedActions={New Template + New Folder}>`.
- **IMPORTANT — the planner MUST read the actual route files first** to place the layout correctly: `src/app/(dashboard)/settings/email-templates/page.tsx` + `new/page.tsx` + `[id]/page.tsx`, and `src/app/(dashboard)/email-templates/*` (there are redirects between the two route groups). Put the layout where it wraps BOTH the list and the `[id]` editor of the canonical `/settings/email-templates` experience. Do NOT break the existing redirects.

### List page becomes folder-aware
`settings/email-templates/page.tsx`: the sub-sidebar now provides the folder tree; the main grid can stay, but `listTemplates()` should also select `folder_id`/`position`. Keep the existing card grid + `TemplateListActions`. (Full folder-scoped filtering of the grid is optional polish — the sidebar tree is the primary organizer.)

### Verification bar (code-only)
`npm run build` exit 0. Runtime (sidebar renders, drag works) is post-apply human-verify — not a gap (the `folders`/`email_templates.folder_id` don't exist in the connected DB until 1225+1228 are applied).
</decisions>

<code_context>
## Existing Code Insights
- `src/app/(dashboard)/workflows/layout.tsx`, `src/components/workflows/workflow-sub-nav.tsx`, `src/app/(dashboard)/workflows/_actions/folders.ts` — the exact pattern to mirror (post-115 core-delegation form).
- `src/components/layout/sub-sidebar.tsx` (SubSidebarLayout) + `src/components/layout/draggable-tree-nav.tsx` (DraggableTreeNav + TreeNavActions/TreeNavFolder) — generic, reuse as-is.
- `src/components/workflows/new-folder-button.tsx` / `folder-create-dialog.tsx` — reusable New Folder button+dialog (may need a prop for entity or the create action; check).
- `src/app/(dashboard)/email-templates/actions.ts` — `listTemplates`/`getTemplate`/etc.; add `folder_id`,`position` to the select.
- `src/lib/foldering/core.ts` — delegate target.
</code_context>

<specifics>
## Specific Ideas
- Reuse, don't rebuild — the tree UI + sub-sidebar are already generic and used by Workflows/Projects/Tools.
- Keep `NewFolderButton` create wired to the new email-template folder create action (entity_type='email_template').
</specifics>

<deferred>
## Deferred Ideas
- Stable block ids → Phase 118. Palette + DnD → 119. Publish → 120. Sending → 121.
- Folder-scoped filtering of the main grid (optional) can be a light follow-up; the sidebar tree is the deliverable here.
</deferred>

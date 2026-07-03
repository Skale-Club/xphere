# Phase 123: WhatsApp Templates Relocation + Search/Filter - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

The existing WhatsApp templates screen (`src/app/(dashboard)/integrations/whatsapp/templates/page.tsx`) gets a real Settings nav entry point and gains search/filter tooling. No changes to the underlying sync/approval mechanics, no changes to the two provider tables (`whatsapp_templates` for Meta Cloud, `zernio_whatsapp_templates` for Zernio), no folders/categorization hierarchy.

</domain>

<decisions>
## Implementation Decisions

### Page Location & Layout
- New route: `/settings/whatsapp-templates`. The existing page at `src/app/(dashboard)/integrations/whatsapp/templates/page.tsx` moves here (or is re-implemented at the new path reusing the same data-fetching logic) — plain settings page, NOT wrapped in the folder-tree `SubSidebarLayout` used by Email Templates/Workflows. No hierarchy needed, so no tree nav (matches the simpler style of e.g. `/settings/api-keys`).
- Keep the existing grouped-by-status section layout as the base structure; search/filter narrow within/across those groups (collapse to a flat filtered list only when a filter or search term is active, per user preference for minimal rework of the existing visual pattern).
- The existing dual-provider branching (Meta Cloud vs Zernio vs not-connected fallback) stays exactly as-is — this phase only adds chrome around whichever branch already renders.

### Search & Filter Controls
- One text input for name search + three native `<select>` dropdowns for Status / Category / Language, combinable (AND logic — narrowing simultaneously), consistent with the native-select pattern already used in the email-campaign template picker (Phase 121).
- Client-side, instant filtering — no debounce/server round-trip needed since the page already loads the full template set with no pagination today (WAT-04 explicitly preserves this).
- Status values stay exactly what they are today: Meta Cloud = APPROVED/PENDING/REJECTED/PAUSED/DISABLED; Zernio = same set minus PAUSED. Category = MARKETING/UTILITY/AUTHENTICATION. Language = whatever values exist in the org's synced templates (derive filter options dynamically from the loaded data, don't hardcode a language list).

### Nav & Entry Points
- New Settings sub-nav item under the (still-named "Communications" until Phase 125) section: label "WhatsApp Templates", route `/settings/whatsapp-templates`. Icon: pick a lucide icon distinct from the already-used `Phone`/`Mail`/`MessageSquare` — recommend `MessageCircle`.
- Existing contextual entry points continue to work, just repointed: the "Manage templates" button in `src/components/integrations/panels/whatsapp-cloud-panel.tsx:279` and the chat template picker fallback link in `src/components/chat/chat-area/send-template-dialog.tsx:254` both update their href to `/settings/whatsapp-templates`.
- Do NOT touch this phase's placement within "Communications" vs "Templates" — the section rename to "Templates" is Phase 125's job. This phase just needs the route + nav entry to exist somewhere reachable; Phase 125 will move/relabel around it if the nav item needs repositioning at rename time.

### Claude's Discretion
Exact spacing/visual polish of the filter bar, exact lucide icon choice if `MessageCircle` conflicts with something else already in use, whether to keep the page as a Server Component with a client sub-component for the interactive filter state (recommended: yes, mirrors how other list pages in this codebase split server-fetch / client-interactivity).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/(dashboard)/integrations/whatsapp/templates/page.tsx` — current implementation, two branches (Meta Cloud / Zernio) plus not-connected fallback, `STATUS_COLOR` map (lines ~49-55).
- `src/lib/whatsapp/cloud/templates.ts` `syncTemplates()` — pull-based sync from Meta, unaffected by this phase.
- `src/lib/zernio/process-event.ts` webhook handler for `whatsapp.template.status_updated` — unaffected.
- Email-campaign template picker (Phase 121) — reference for the native-`<select>` pattern already established in this codebase.

### Established Patterns
- `src/components/settings/settings-sub-nav.tsx` is the sole nav definition — add the new item here (still under Communications for now).
- Server component fetches full dataset, no pagination anywhere in this screen today.

### Integration Points
- `src/components/integrations/panels/whatsapp-cloud-panel.tsx:279` — "Manage templates" button href.
- `src/components/chat/chat-area/send-template-dialog.tsx:254` — chat composer fallback link.

</code_context>

<specifics>
## Specific Ideas

Status/category/language filters must be combinable (all three can be applied at once alongside the name search), matching WAT-03's plural phrasing.

</specifics>

<deferred>
## Deferred Ideas

Folder/category hierarchy for WhatsApp templates (explicitly out of scope per REQUIREMENTS.md Future Requirements — revisit only if search+filter proves insufficient).

</deferred>

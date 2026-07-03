# Phase 125: Messages Preview + Templates Nav Finalization - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Two independent deliverables that both depend on Phase 123 (WhatsApp Templates relocated) and Phase 124 (Messages Templates CRUD) already being live:
1. A per-channel resolution preview inside the Messages template editor (MSG-05).
2. Renaming the Settings sub-nav "Communications" section to "Templates" now that it has three real entries (NAV-03, NAV-04).

</domain>

<decisions>
## Messages Preview (MSG-05)
- The Messages template editor (`src/app/(dashboard)/settings/message-templates/_components/message-template-editor.tsx`, built in Phase 124) already has tabs: Default, SMS, Email, WhatsApp. Add a 5th tab, "Preview", showing all three channel resolutions at once (SMS / Email / WhatsApp), each resolving to its `channel_overrides[channel]` value if set, otherwise falling back to the default `body` — computed client-side from current in-memory form state (NOT from the last-saved DB row), so it updates live as the admin types, before saving.
- No new server action needed — this is pure client-side derivation of already-available form state (default body + 3 optional override fields).

## Templates Nav Finalization (NAV-03, NAV-04)
- In `src/components/settings/settings-sub-nav.tsx`, rename the `heading: 'Communications'` section to `heading: 'Templates'`. The three items already present in that section (added across Phases 122/123/124) are, in order: Email Templates, Messages, WhatsApp Templates — keep that order, no reordering needed.
- NAV-04 (extensibility) has no separate code deliverable — it's a property of the existing `SECTIONS`/`NavItem` array pattern already in place (adding a future template kind is already just one more object literal in the array). This phase's job is only to confirm/document that this remains true after the rename — no structural change required.

### Claude's Discretion
Exact preview tab visual layout (e.g., three stacked read-only text blocks each labeled with channel name and a small "(using default)" vs "(custom)" indicator) is at Claude's discretion — no specific mockup was requested, just accurate resolution + clear labeling of override-vs-fallback per channel.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/(dashboard)/settings/message-templates/_components/message-template-editor.tsx` (Phase 124) — existing Tabs component with Default/SMS/Email/WhatsApp panels; add Preview as a 5th `TabsTrigger`/`TabsContent`.
- `src/components/settings/settings-sub-nav.tsx` — `SECTIONS` array, `Communications` heading currently has: Email Templates (`/settings/email-templates`), Messages (`/settings/message-templates`), WhatsApp Templates (`/settings/whatsapp-templates`).

### Established Patterns
- Tabs primitive already imported/used in the editor from Phase 124 — reuse the same import, don't add a new tabs dependency.

### Integration Points
- None beyond the one editor component file and the one nav file.

</code_context>

<specifics>
## Specific Ideas

None beyond what's captured above — this phase is intentionally small and mechanical relative to Phase 124's data-model work.

</specifics>

<deferred>
## Deferred Ideas

None — this is the final phase of the v3.3 milestone; anything not covered here is already tracked in REQUIREMENTS.md's Future Requirements / Out of Scope sections (composer integration, campaign body use, WhatsApp folders, Calls architecture rethink).

</deferred>

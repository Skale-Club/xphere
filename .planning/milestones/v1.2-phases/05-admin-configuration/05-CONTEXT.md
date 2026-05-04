# Phase 5: Admin Configuration - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the dashboard-facing widget configuration area for the active organization. This phase delivers:
- per-org widget settings stored on `organizations`
- an authenticated dashboard page for editing widget display name, primary color, and welcome message
- a live preview that reflects unsaved edits
- an embed code panel that shows the ready-to-install `<script>` tag with the org's public token
- widget token regeneration that invalidates previous installs
- a public config endpoint the widget can read at startup

This phase does NOT add visitor analytics, operator tooling, white-label hosting, or system-prompt editing. The requirements for this phase are limited to `ADMIN-01` through `ADMIN-04`.

</domain>

<decisions>
## Implementation Decisions

### Configuration Storage
- **D-01:** Widget appearance settings live directly on the `organizations` row. Add three columns via a new migration:
  - `widget_display_name`
  - `widget_primary_color`
  - `widget_welcome_message`
- **D-02:** `organizations.widget_token` remains the single public install/auth token. No new widget table is introduced in v1.2 because configuration is one widget per org, not a multi-widget system.

### Dashboard Surface
- **D-03:** Add a dedicated top-level dashboard route for this feature at `/widget` with its own sidebar item labeled `Widget`.
- **D-04:** Mutations use authenticated server actions with the existing cached auth helpers (`createClient()`, `getUser()`), update only the active org, and revalidate the widget page after saves.

### Preview + Embed Experience
- **D-05:** The dashboard page includes a live preview component that mirrors the real widget UI contract but does not load `public/widget.js` or mount a real Shadow DOM widget inside the admin page.
- **D-06:** The embed code shown to admins is a single script tag using the canonical production host and the org's current public token:
  ```html
  <script src="https://voiceops.skale.club/widget.js" data-token="<widget_token>"></script>
  ```
- **D-07:** The preview must reflect unsaved form edits immediately for display name, color, and welcome message.

### Public Runtime Config
- **D-08:** Add a separate public read endpoint at `GET /api/widget/[token]/config` that returns only safe public widget fields:
  - `displayName`
  - `primaryColor`
  - `welcomeMessage`
- **D-09:** The widget fetches that config endpoint at init time and falls back to Phase 4 defaults if the fetch fails.

### Token Rotation
- **D-10:** Token regeneration is an explicit admin action that writes a fresh `crypto.randomUUID()` value to `organizations.widget_token`.
- **D-11:** The UI must clearly warn that regenerating the token immediately invalidates previously installed embed scripts.

### Scope Guardrails
- **D-12:** `system_prompt` editing is out of scope for this phase even though Phase 3 noted it as a future override point. No `system_prompt` column or UI is added here because it is not part of `ADMIN-01..04`.
- **D-13:** `widget_primary_color` accepts a hex color in `#RRGGBB` format only. Validation should happen both in the form schema and before persistence.

### Claude's Discretion
- Exact page layout and copy tone for the settings form, preview card, and embed code block
- Whether the preview renders as a phone-sized frame, floating card, or full widget shell
- Whether token regeneration sits inline with settings or in a separate danger zone card
- Whether the public config endpoint returns empty-string values or normalized defaults when org fields are null/blank

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing token + chat wiring
- `supabase/migrations/012_org_widget_token.sql` - existing `organizations.widget_token` column
- `src/app/api/chat/[token]/route.ts` - public chat route that already resolves org by `widget_token`

### Widget implementation to extend
- `src/widget/index.ts` - current widget client; Phase 5 adds startup config fetch behavior
- `.planning/phases/04-widget-embed-script/04-CONTEXT.md` - Phase 4 decisions, especially the Phase 5 handoff note about config fetching
- `.planning/phases/04-widget-embed-script/04-UI-SPEC.md` - header and welcome copy currently hardcoded and intended for Phase 5 override

### Dashboard patterns
- `src/components/layout/app-sidebar.tsx` - existing top-level navigation structure
- `src/app/(dashboard)/organizations/actions.ts` - current server action patterns for org updates and revalidation
- `src/lib/supabase/server.ts` - cached auth helpers to use in pages and actions

### Project conventions
- `CLAUDE.md` - App Router patterns, auth helpers, canonical production origin
- `.planning/REQUIREMENTS.md` - `ADMIN-01..04` scope

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `organizations.widget_token` already exists and is used in production chat requests, so token rotation can piggyback on the current public auth path.
- The widget already supports a minimal hardcoded UI from Phase 4; Phase 5 only needs to hydrate runtime-configurable strings and color.
- The dashboard already has authenticated org-scoped mutation patterns that can be reused for widget settings.

### Established Patterns
- Server components by default for dashboard routes; client components only where interactive form/preview state is needed.
- Server actions should use `createClient()` and `getUser()` instead of direct `supabase.auth.getUser()` calls.
- Public widget-facing routes should stay lean and return only non-sensitive data.

### Integration Points
- Saving settings updates the active org record and immediately affects both the dashboard preview and future widget boots.
- Regenerating the token changes both the embed code shown in the dashboard and the token accepted by `/api/chat/[token]`.
- The new config endpoint and widget startup fetch are the only public-runtime changes required for this phase.

</code_context>

<specifics>
## Specific Ideas

- Keep the page tightly scoped: settings form, preview, embed code, token regeneration.
- Treat the preview as a design mirror of the widget, not the actual install artifact.
- Keep the config endpoint token-based and separate from the chat POST route so boot-time UI config and message handling remain decoupled.
- Use production host `https://voiceops.skale.club` in the generated script tag until planning explicitly changes the canonical public origin.

</specifics>

<deferred>
## Deferred Ideas

- System prompt editing
- Widget analytics
- Multiple widget variants per org
- Advanced theming beyond a single primary color

</deferred>

---

*Phase: 05-admin-configuration*
*Context gathered: 2026-04-04*

# Email Builder — Production Hardening Plan

**Status:** ✅ Code complete (2026-07-15) — all code phases (1, 2, 3, 4, 5, 6) shipped, each Sonnet-executed + Opus-validated. Phases 1+2 deployed (`037eefa5`, `d1fabe9f`, fixes `c4f9242c`); 3+5+6 deployed (`968d40b5`, `28c6610c`); Phase 4 merged (MSO/VML Outlook hardening, renderer suite 59 tests, QA-MATRIX.md + kitchen-sink.html; arcsize cap raised to 100% post-validation). Prod data confirmed zero legacy /email-marketing usage → full code deletion is a safe future cleanup. Remaining MANUAL work: Phase 0 (browser click-test QA — needs an authenticated session) and filling QA-MATRIX.md against real email clients.
**Owner request (pt-BR):** "nosso sistema ainda está meio em beta mode, precisamos fazer um plano para deixar ele pronto e robusto"
**Scope:** the block-based email template builder (`/email-templates`, `src/app/(dashboard)/email-templates/`, `src/lib/email/render-template.ts`) and its send path.
**Context:** builder created 2026-05-26 (commit `e0c9e079`), overhauled in v3.4 (3-pane editor, image upload). Architecture is solid; what's missing is security hardening, send-path compliance, and a handful of product gaps. Browser QA from v3.4 was never done.

---

## Findings driving this plan (from 2026-07-14 code audit)

| # | Finding | Severity | Where |
|---|---------|----------|-------|
| 1 | No HTML sanitization anywhere: text/heading `content` and `html` blocks are stored and rendered raw (`dangerouslySetInnerHTML` on canvas, raw emit in `renderTemplate`). Stored XSS between org members. `href`/`src`/`link` accept `javascript:` | **P0** | `render-template.ts`, `canvas.tsx` |
| 2 | `send_email_template` executor sends via `sendPlatformEmail` — bypasses the suppression list, compliance footer, and List-Unsubscribe headers that `sendTenantEmail(kind:'marketing')` already implements. Sends drafts (no published check). No plain-text part despite `plain_text_snapshot` existing | **P0** | `executors/send-email-template.ts` |
| 3 | No server-side validation of the document JSON on save — any shape enters the `document` jsonb | P1 | `actions.ts` `saveTemplate` |
| 4 | Closing the tab with unsaved changes silently loses work (no `beforeunload` guard, no autosave) | P1 | `email-template-editor.tsx` |
| 5 | Section templates flatten to `{ blocks }` — 2/3-col layout, background, padding are lost on save; insert dumps blocks into an existing column | P1 | `handleSaveSectionTemplate`, `insertSectionTemplate` |
| 6 | Blocks cannot move between sections (guard `target.sectionId !== from.sectionId` in `handleDragEnd`; `moveBlock` helper already supports it). Drag silently no-ops | P1 | `email-template-editor.tsx:481` |
| 7 | No subject or preview-text (preheader) on the template — executor falls back to template *name* as subject; renderer emits no preheader (legacy renderer had one) | P1 | schema + `render-template.ts` |
| 8 | Upload allows SVG into a public bucket (script-capable content type); no per-org quota | P2 | `api/email-templates/upload/route.ts` |
| 9 | Renderer lacks MSO conditionals/VML (Outlook desktop: square buttons, no bg-image fallback) and `<title>` | P2 | `render-template.ts` |
| 10 | Legacy parallel system at `/email-marketing` (AI HTML sections, own renderer/editor) duplicates the concept; the builder already has its own AI generation (`/api/email-templates/generate` → EmailDocument) | P2 | `src/lib/email-marketing/*`, `src/components/email-marketing/*` |
| 11 | Dead/stale surface: `addBlock` in `EditorApi` appears orphaned; registry comment references a removed in-column "+ Block" menu | P3 | `context.ts`, `registry.tsx` |

---

## Phase 0 — Browser QA baseline (½ day)

The v3.4 overhaul shipped without click-through QA. Establish the baseline before changing anything.

- [ ] Run the dev server, click-test: create template → add sections/blocks (all 7 types) → drag from palette → reorder → inspector edits → undo/redo → save → preview desktop/mobile → publish → duplicate → delete.
- [ ] Same pass for the section-template editor (`variant='section'`).
- [ ] Image upload end-to-end (bucket write + public URL renders).
- [ ] File bugs found as checkboxes here; fix P0s immediately, fold the rest into phases below.

## Phase 1 — Security & data integrity (P0, ~1–2 days)

- [ ] **Server-side sanitization** on `saveTemplate` / `updateSectionTemplate` / `publishTemplate` and on `/api/email-templates/generate` output: sanitize `text`/`heading` content (inline allowlist: `a strong em u br span` + `style` subset) and `html` blocks (broader allowlist, no `script`/`iframe`/event handlers). Library: `sanitize-html` (Node).
- [ ] **URL scheme validation**: `href`/`link`/`src`/`backgroundImage` must be `https:`/`http:`/`mailto:`/`tel:` or `{{merge.tag}}`-bearing — reject `javascript:`/`data:`.
- [ ] **Canvas-side DOMPurify** for `dangerouslySetInnerHTML` previews (text/heading/html) — defense in depth for docs saved before sanitization existed.
- [ ] **Zod schema for `EmailDocument`** enforced in save actions, with hard limits (≤ 50 sections, ≤ 100 blocks/column, content ≤ 100 KB/block, doc ≤ 1 MB). Structured error back to the editor toast.
- [ ] **Drop SVG** from the upload MIME allowlist (PNG/JPEG/GIF/WebP stay).
- [ ] **`beforeunload` guard** when `isDirty`.
- [ ] Unit tests: sanitizer policy (script/onerror/javascript: stripped; benign inline formatting preserved), zod rejects malformed docs.

**Acceptance:** a template containing `<script>`, `onerror=`, or `javascript:` links cannot be persisted, and legacy-stored payloads don't execute on the canvas or in snapshots.

## Phase 2 — Send-path compliance (P0, ~1 day)

Marketing email without suppression/unsubscribe is a deliverability and legal liability. The machinery already exists (`sendTenantEmail(kind:'marketing')` — suppression check, org-address footer, `List-Unsubscribe` + one-click headers); the builder's executor just doesn't use it.

- [ ] `send_email_template`: route through `sendTenantEmail(..., { kind })`, defaulting `kind:'marketing'`; keep an explicit `kind:'transactional'` escape hatch param.
- [ ] Send `plain_text_snapshot` as the text part (extend `sendTenantEmail`/Resend payload with `text`).
- [ ] Require `status='published'` to send (or an explicit `allow_draft` param) — today drafts with a stale snapshot can go out.
- [ ] Subject: use the new template `subject` field (Phase 3) → param override → **error** if neither (stop silently sending with the template name as subject).
- [ ] Audit the campaigns email path (`src/lib/campaigns/`) for the same guarantees; fix if it uses the platform sender.
- [ ] Tests: suppression honoured, footer + headers present, draft send rejected.

**Acceptance:** every builder-template marketing send goes out via the tenant integration with suppression, footer, and one-click unsubscribe; unsubscribed recipients are skipped.

## Phase 3 — Editor product gaps (P1, ~2–3 days)

- [ ] **Subject + preview text** as document/template fields (editable in the Document inspector under "Email settings"); renderer emits hidden preheader (`&nbsp;&zwnj;` padding, mirroring the legacy renderer) + `<title>`.
- [ ] **Cross-section block moves**: delete the same-section guard in `handleDragEnd` (the pure helper already handles it); QA the drop-target highlight across sections.
- [ ] **Real section templates**: new doc shape `{ section: EmailSection }` with upgrade-on-read from legacy `{ blocks }` (mirror the `normalizeDocument` pattern — no migration). Save keeps layout/columns/bg/padding; palette drop inserts a **new section** at the drop position; keep blocks-into-column as the fallback for legacy rows.
- [ ] **Merge-tag picker**: toolbar/inspector dropdown listing canonical tags (`contact.first_name`, `contact.email`, `org.name`, …) that inserts `{{ … }}` at the cursor / into the focused field.
- [ ] **Preview with sample data**: run `renderWithVariables` over the preview HTML with a sample contact, with a toggle raw/merged.
- [ ] **Send test email** button (to the signed-in user) using the exact Phase 2 path (minus suppression skip).

**Acceptance:** a user can build, personalize, preview-with-data, and test-send a complete campaign email without leaving the editor, and reusable sections survive round-trips intact.

## Phase 4 — Deliverability & rendering robustness (P1, ~1–2 days)

- [ ] MSO conditional comments in the head (port from `email-marketing/render.ts`); VML `roundrect` fallback for buttons; document the known bg-image limitation on Outlook.
- [ ] Extend `render-template` unit tests: every block prop renders; padding fallbacks; column stacking classes; preheader/title; escaping.
- [ ] Manual client QA matrix (Gmail web/app, Outlook desktop/web, Apple Mail) with a kitchen-sink template; record results in `QA-MATRIX.md` here.

## Phase 5 — Consolidation & cleanup (P2, ~1 day + decision)

- [ ] **Decide the legacy `/email-marketing` system's fate.** Recommendation: retire it — the builder already covers AI generation (`/api/email-templates/generate` emits `EmailDocument`). Redirect the route, mark the code deprecated, plan data migration for existing rows if any org uses it.
- [ ] Remove the orphaned `addBlock` from `EditorApi` (or re-add an in-column "+ Block" menu deliberately); fix the stale registry comment.
- [ ] Per-org upload quota (count/bytes) + a scheduled orphan-asset sweep (assets not referenced by any `document`).

## Phase 6 — Autosave & polish (P2, ~1 day)

- [ ] Debounced draft autosave (leverage `isDirty` + `runWithFreshDoc`), with explicit Save still refreshing snapshots; or minimum viable: localStorage draft recovery on reopen.
- [ ] Empty-state and error-state polish flagged during Phase 0 QA.

---

## Out of beta — definition of done

- [ ] No unsanitized HTML persisted or rendered (Phase 1)
- [ ] All marketing sends compliant: suppression + footer + List-Unsubscribe + text part (Phase 2)
- [ ] Subject/preheader first-class; test-send from the editor (Phase 3)
- [ ] Section templates preserve full sections (Phase 3)
- [ ] Render test suite green; client matrix documented (Phase 4)
- [ ] One email system, not two (Phase 5)
- [ ] Browser QA pass recorded (Phase 0, re-run at the end)

**Total estimate:** ~7–10 working days sequential; Phases 1+2 are independent of 3+ and worth shipping first as their own PR.

## Risks / notes

- Sanitization of *existing* stored documents: sanitize on read where rendered (canvas) and on next save — do NOT mass-rewrite jsonb in a migration.
- Changing section-template doc shape must keep upgrade-on-read both ways (old `{ blocks }` rows keep working forever).
- `sendTenantEmail` requires a connected tenant Resend integration; orgs without one currently "work" via the platform key through the executor — Phase 2 changes that behavior deliberately (surface a clear error instead).

---

## Phase 7 — Collapsed rails & palette UX (added 2026-07-15 from owner visual QA) — ✅ SHIPPED 2026-07-15

> Status: all four sub-tasks implemented (Sonnet) + Opus-validated (APPROVE) + merged, plus follow-up 7.5 (`a4d53f67` / merge `55e0b32c`): CollapsedRail now renders the toggle itself (single size/color authority), chip icons normalized. **Owner visually confirmed the rails in production 2026-07-15 ("ficou ótimo")** — closes the visual acceptance for 7.1/7.3. Still browser-only: drag-from-collapsed-chip (7.2), folded into Phase 0. Non-blocking backlog: pre-existing `set-state-in-effect` lint in block-palette/inspector-panel; expanded-HEADER toggles (h-6/h-3.5) are smaller than the collapsed-rail toggle (h-7/h-4) — optional harmonization.

**Owner report (pt-BR):** on `/settings/email-templates/[id]` three collapsed rails sit side by side (Settings sub-sidebar · Email Templates sub-sidebar · editor Blocks palette) and (a) collapsed rails render at a DIFFERENT height than their expanded panels; (b) the Blocks palette collapses to an empty strip — it must keep its elements usable; (c) the Email Templates collapsed rail shows two identical blue "+" buttons (template vs section indistinguishable) and lacks the full action set that the expanded panel's two tabs offer.

**Root context:** three INDEPENDENT collapse implementations that drifted:
- `src/components/layout/sub-sidebar.tsx` — `SubSidebarLayout` rail: `w-10`, `CollapsedRail` (toggle + `collapsedActions`); expanded swaps to `absolute inset-y-0` on mobile / `md:relative` desktop (`:178-180`).
- `src/app/(dashboard)/email-templates/_components/block-palette.tsx` — own state (`email-editor:palette-collapsed`), collapsed `w-9`, renders ONLY the toggle.
- `src/app/(dashboard)/email-templates/_components/editor/inspector-panel.tsx` — own state (`email-editor:inspector-collapsed`), collapsed `w-9`, toggle only.

### 7.1 Height parity (root-cause first — do NOT fix blind)
- [ ] Instrument in the browser (kitchen of ancestors: `offsetHeight`, `position`, `minHeight`, `overflowY` for every ancestor of each rail, expanded vs collapsed) and record which ancestor's height actually changes. Prime suspects: the `absolute inset-y-0` ↔ `relative` swap in sub-sidebar.tsx:178-180 (positioning asymmetry between states), and an unresolved `h-full` somewhere in the nested chain (settings `SubSidebarLayout` → email-templates `SubSidebarLayout` → editor page `flex flex-col h-full`).
- [ ] Fix so expanded and collapsed occupy the identical vertical band on desktop AND mobile (likely: keep both states in-flow `relative` on md+, reserve `absolute` overlay strictly for the mobile-expanded case; add missing `min-h-0`/`h-full` links if the chain breaks).
- [ ] Acceptance: with the editor open, toggling each of the 3 rails does not change its top/bottom pixel position; all three rails and the expanded panels share the same vertical extent.

### 7.2 Blocks palette: functional when collapsed
- [ ] Collapsed palette becomes an icon rail (not an empty strip): the 7 block-type chips render as icon-only draggable chips (same `palette:` dnd ids — drag from the collapsed rail onto the canvas must work), each with `title`/aria-label tooltip.
- [ ] Section templates: icon-only chips (Layers icon, tooltip = name) below a divider, also draggable; if > ~6, show the first N + a "expand to see all" affordance.
- [ ] Normalize rail width with the others (w-10) and reuse one shared CollapsedRail primitive if cheap (see 7.4).
- [ ] Acceptance: with the palette collapsed you can still build an email end-to-end by dragging icon chips.

### 7.3 Email Templates rail: complete, distinguishable actions
- [ ] Replace the two identical "+" with distinct icon buttons mirroring the expanded tabs, in order: **New template** (Mail+), **New template folder** (FolderPlus), divider, **New section** (Layers+), **New section folder** (FolderPlus, section-colored) — tooltips on all; the section-folder button wires `secFolders.createFolder` (today the rail only wires the TEMPLATE folder action — `settings/email-templates/layout.tsx:69`).
- [ ] Composite icons: lucide primary icon + small "+" badge (pattern already used elsewhere in the app? check; else 14px icon + absolute 8px Plus badge).
- [ ] Acceptance: each button visually distinct, correct action per entity, tooltips accurate.

### 7.4 Consolidation (keep it cheap)
- [ ] Extract ONE shared collapsed-rail primitive (toggle at top, actions slot, w-10, identical padding/border) used by sub-sidebar's CollapsedRail, BlockPalette and InspectorPanel — visual consistency without a big refactor. Skip if it balloons; minimum bar is identical width/height/padding via shared constants.
- [ ] Inspector stays content-free when collapsed (nothing useful to show) but matches geometry.

**Execution:** Sonnet executor (worktree; remember: rmdir the node_modules junction BEFORE any worktree removal) → Opus validation → merge. Browser height verification (7.1 acceptance) requires an authenticated session — fold into the pending Phase 0 QA pass.
**Estimate:** ~1 day executor + validation.

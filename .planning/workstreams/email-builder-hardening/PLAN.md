# Email Builder — Production Hardening Plan

**Status:** 🚧 In progress (2026-07-15) — Phases 1+2 ✅ deployed to prod (`037eefa5`, `d1fabe9f` + fixes `c4f9242c`). Phase 5 ✅ merged (`968d40b5`: legacy /email-marketing retired — prod data confirmed zero legacy usage, so full deletion is safe later; upload quota; orphan-asset cleanup endpoint). Phases 3+6 ✅ merged (subject/preview_text columns + preheader/title, cross-section drag, full `{section}` section templates with upgrade-on-read, merge-tag picker, sample-data preview, test send, autosave). All Sonnet-executed + Opus-validated. Remaining: Phase 4 (MSO/VML + client QA matrix), Phase 0 (browser QA — needs an authenticated session).
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

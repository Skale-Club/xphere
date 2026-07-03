# v3.4 — Email Editor Overhaul

**Status:** In progress (autonomous overnight run, 2026-07-03)
**Branch:** `feat/email-editor-overhaul` (NOT pushed — review + merge in the morning; `main` auto-deploys to prod)
**Owner request (pt-BR):**
1. Todos os campos de imagem passam a ser **upload de arquivo**, não campo de URL.
2. O **drag-and-drop dos blocos** vira a prioridade; os campos de edição não precisam ficar dentro de cada bloco.
3. Rever **toda a organização dos blocos, paddings, margens e alinhamentos** — hoje está inacabado.
4. Entregar um **projeto robusto e completo**.

---

## Root-cause diagnosis

The editor is a single **1453-line** file (`email-template-editor.tsx`) where **each block edits itself with tiny form-field rows rendered inside the block, on the canvas**, only when selected. That one decision produces every symptom the screenshot shows:

- The canvas is simultaneously a preview *and* a cramped form → "unfinished" look.
- Spacing/alignment controls are ad-hoc (raw drag handles on section edges, `10px` inputs) with no shared scale.
- Blocks have almost no styling surface (no per-block padding, no block alignment, image is center-only, button is center-only).
- Images are URL-only text inputs — no upload.

## Target architecture — 3-pane builder

```
┌──────────┬──────────────────────────────┬─────────────────┐
│ Palette  │  Canvas (WYSIWYG)            │  Inspector      │
│ (drag    │  - blocks render as email   │  (context:      │
│  source) │  - inline text edit only    │   block /       │
│          │  - clean selection toolbar  │   section /     │
│          │  - drag / dup / del / move  │   document)     │
└──────────┴──────────────────────────────┴─────────────────┘
```

All form fields move OUT of the canvas into the right-side **Properties Inspector**. The canvas only shows the block as it will render, plus inline `contentEditable` for text/heading and a small floating toolbar.

---

## Every improvement point (the full audit)

### A. Data model + rendering (`src/lib/email/render-template.ts`)
- [ ] Add `padding: BlockPadding` to every block (per-block spacing, not just section).
- [ ] Add block-level `align` where it makes sense (image, button, divider) — currently hardcoded center.
- [ ] Image: `width` control (px / % / "full"), `align`, `borderRadius`.
- [ ] Button: `align`, `fullWidth`, `fontSize`, `paddingY`/`paddingX`.
- [ ] Divider: `align`, `width` (%), `style` (solid/dashed/dotted).
- [ ] Spacer: keep, expose in inspector.
- [ ] Section: `verticalAlign` (top/middle/bottom), optional `backgroundImage`, `borderRadius`.
- [ ] A shared spacing scale constant `SPACING_STEPS = [0,4,8,12,16,24,32,48,64]`.
- [ ] `renderTemplate` emits all new props, email-safe (tables + inline CSS, Outlook-friendly).
- [ ] Update `BLOCK_DEFAULTS`; keep `normalizeDocument` upgrade-on-read backward compatible.

### B. Image upload (directive #1)
- [ ] Migration `1234_email_assets_bucket.sql` — public `email-assets` bucket (idempotent, modeled on `1122_chat_media_bucket.sql`).
- [ ] `POST /api/email-templates/upload` — image-only, 10 MB, service-role, returns public URL (modeled on `/api/chat/upload`).
- [ ] `<ImageUploader>` reusable component: drag-drop + browse + progress + preview + replace/remove.
- [ ] Upload is primary; a collapsed "advanced: paste URL" remains for external CDN images.
- [ ] Wire into image inspector AND section background-image.

### C. Editor refactor (directive #2)
- [ ] Split the monolith into `_components/editor/*`: palette, canvas, canvas-block, inspector panel + per-type inspectors, block registry, shared uploader.
- [ ] `useEmailEditor` hook: doc state + selection + history (undo/redo).
- [ ] Canvas: WYSIWYG only, inline text edit, floating block toolbar (drag / duplicate / move up / move down / delete).
- [ ] Keep `EmailTemplateEditor` public API stable (route page unchanged).

### D. Spacing / alignment / polish (directive #3)
- [ ] Inspector spacing controls use the shared scale (segmented + numeric, linked/unlinked padding).
- [ ] Section padding: keep drag handles but polish; add numeric inspector controls.
- [ ] Consistent selection outline, hover affordances, section/block hover labels, better empty states.
- [ ] Cleaner canvas chrome (device frame, zoom-neutral), better "Add section" affordance.

### E. Robustness (stretch, as time allows)
- [ ] Undo/redo history + keyboard (⌘Z / ⌘⇧Z).
- [ ] ⌘S to save, Delete/Backspace to remove selected, Esc to deselect.
- [ ] Duplicate block / duplicate section.
- [ ] Dirty-state indicator (unsaved changes) + optional debounced autosave.
- [ ] Mobile / desktop preview toggle in the preview dialog.
- [ ] Tests: extend `editor-dnd` tests; add `render-template` tests for new props.

---

## Execution phases (each ends green + atomic commit)

- **Phase A — Foundation:** model + render + storage + upload route + tests. (No UI risk.)
- **Phase B — Refactor + Inspector:** split monolith, introduce inspector, move fields off canvas.
- **Phase C — Spacing/align + upload wired + polish + robustness.**
- **Phase D — Verify:** build, lint, tests, manual smoke, SUMMARY.

## Constraints honored
- Never edit old migrations; new `1234_*` only.
- `src/lib/crypto.ts`, `src/app/api/vapi/*` untouched.
- Do not push to `main`. Do not touch unrelated in-flight files
  (`copilot/_actions/turn.ts`, `rbac/server.ts`, `credits-indicator.tsx`, phase-125 docs).
- `npm run build` green after every phase.

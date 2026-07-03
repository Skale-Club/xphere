# v3.4 Email Editor Overhaul — Summary

**Branch:** `feat/email-editor-overhaul` · **Status:** built green, tested, ready for review
**Date:** 2026-07-03 (autonomous overnight run)

## What shipped (3 commits, all build-green)

| Commit | Phase | Contents |
|--------|-------|----------|
| `7345f910` | A — Foundation | Extended block model + email-safe rendering, `email-assets` bucket migration (1234), `/api/email-templates/upload` route, render tests |
| `138571dc` | B — Refactor | 3-pane builder: palette · WYSIWYG canvas · Properties Inspector; modular `editor/` package; undo/redo; keyboard; image uploader |
| `97404a01` | C — Hardening | Save/preview commit-on-blur correctness; lossless section layout reflow (extracted + tested) |

## The three directives — all addressed

1. **Images are uploads, not URL fields.** New public `email-assets` bucket +
   `POST /api/email-templates/upload` (10 MB, image-only, service-role, public
   URL) + `<ImageUploader>` (drag-drop / browse / progress / replace / remove).
   Used by the Image block **and** section background image. The bare URL field
   is gone; a subtle "paste a URL" stays as an advanced escape hatch.

2. **Drag-drop is the priority; fields left the blocks.** The canvas is now pure
   WYSIWYG — blocks render as they'll send, with inline text editing and a small
   floating toolbar (drag · duplicate · delete). **Every** property control moved
   to a context-aware **Properties Inspector** on the right (block / section /
   document). Answers the exact question asked: the per-block field clutter is
   removed.

3. **Spacing / alignment / organization rebuilt.** Per-block padding (4-side,
   link toggle, shared scale), block alignment (text/heading/image/button/
   divider), image width+radius, button align/full-width/padding, divider
   width/style, section vertical-align + background image + radius + column gap.
   A single padding wrapper is now the one source of vertical rhythm.

## Robustness extras

Undo/redo with burst-coalescing (⌘Z / ⌘⇧Z) · ⌘S save · Delete/Esc · duplicate &
move blocks & sections · unsaved-changes indicator · desktop/mobile preview
toggle · polished palette, empty states, selection/hover affordances · the
1453-line monolith split into a documented `editor/` module tree.

## Verification

- `npm run build` — green after every phase.
- `npm run lint` — clean for the touched files.
- Unit tests — 69 passing across `email-render-styling`, `email-editor-dnd`
  (incl. new `reflowSectionColumns`), `email-template-builder`, `email-block-ids`,
  `email-merge-tags`. Backward compatibility with existing templates verified.
- Dev server — all routes compile; editor route module graph loads with no
  server errors (full UI click-through blocked by auth, see below).

## ⚠️ Two things need you in the morning

1. **Apply migration `1234_email_assets_bucket.sql`** (and the already-pending
   `1233`) to the remote DB via your usual MCP flow — image upload can't store
   files until the `email-assets` bucket exists. It's additive + idempotent.
2. **Browser QA the editor** — it's behind auth, so I could not click through the
   live UI. Please open a template and exercise: image upload, block DnD from the
   palette, inspector controls, undo/redo, save, and preview (desktop/mobile).

## Notes

- A parallel GSD process committed the v3.3 / phase-125 work onto this same
  branch between my commits. My changes are cleanly scoped and identifiable by
  the `feat(email-editor)` prefix (`7345f910`, `138571dc`, `97404a01`) — cherry-
  pick those onto `main` if you want an email-only PR.
- **Not pushed.** `main` auto-deploys to prod; review then merge/push yourself.
- Deferred (documented, not built): a merge-tag/personalization inserter — needs
  the send-pipeline variable schema to offer only resolvable tokens.

---
status: passed
phase: 120-publish-lifecycle
verified: 2026-07-02
mode: code (build-verified; runtime click-through deferred post-migration)
---

# Phase 120 Verification — Publish Lifecycle

**Result: PASSED at build level.** `npm run build` exit 0 (twice).

## Success Criteria
1. **Single status scheme (draft/published[/archived]) across defaults, badges, save logic** — ✅ `STATUS_CLASSES` draft|published|archived + `displayStatus()` legacy `'ready'`→published; `createTemplate` default 'draft'. `status` is plain string (no union change needed).
2. **Publish/unpublish from editor toolbar + list card** — ✅ `publishTemplate`/`unpublishTemplate` actions; toolbar toggle + `TemplateListActions` quick action (router.refresh, no full reload).
3. **Publishing refreshes HTML snapshot; status consistent list↔editor** — ✅ `publishTemplate` re-renders `html_snapshot`/`plain_text_snapshot` via `renderTemplate`.
4. **npm run build passes** — ✅ exit 0.

## Requirements
- UFE-09 ✅ — build-verified.

## Deferred (not a gap)
- Runtime publish click-through — post-apply (routes nest under folder-querying layout). Migration `1229` (status normalize) is LOW-risk cleanup; code maps `ready`→published defensively so applying isn't strictly required.

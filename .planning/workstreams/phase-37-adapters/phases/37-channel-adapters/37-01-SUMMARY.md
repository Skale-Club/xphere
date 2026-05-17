---
plan: 37-01
phase: 37
status: complete
completed: 2026-05-16
---

# Summary: Plan 37-01 — Channel Adapter Modules

## What was built

Created `src/lib/agent-runtime/adapters/` with 6 files implementing the channel adapter pattern for Phase 37:

- `index.ts` — shared types (`ChannelMessage`, `ManychatDynamicBlock`, `FormatOptions`), `stripMarkdown()`, `splitAtSentenceBoundary()`, and re-exports of all 5 channel formatters
- `web_widget.ts` — no limit, no markdown stripping (widget renders markdown natively)
- `whatsapp.ts` — 1600-char limit, markdown stripped
- `meta.ts` — 2000-char limit, markdown stripped
- `manychat.ts` — 640-char limit, Dynamic Block v2 format, markdown stripped
- `telegram.ts` — 4096-char limit, markdown stripped

## Key decisions

- `splitAtSentenceBoundary()` prioritizes sentence boundaries (`. ! ?`), falls back to word boundary, then hard cut — canonical CHAN-02 implementation
- `stripMarkdown()` handles all standard markdown patterns; WhatsApp-native markup (`*bold*`, `_italic_`) is preserved by design
- All adapters are pure functions with no I/O or server imports — safe to use in any Node.js context

## Commits

- `feat(37-01): add channel adapter modules (web_widget, whatsapp, meta, manychat, telegram)`

## Self-Check: PASSED

- All 6 files exist
- All adapters export `formatOutbound(text, opts?) => ChannelMessage[]`
- No imports from `next/server`, Supabase, or server-only modules
- Shared utilities exported from index.ts

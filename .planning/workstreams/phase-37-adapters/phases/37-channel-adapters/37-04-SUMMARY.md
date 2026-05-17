---
plan: 37-04
phase: 37
status: complete
completed: 2026-05-16
---

# Summary: Plan 37-04 — Adapter Snapshot Tests

## What was built

Created `tests/agent-runtime-adapters.test.ts` with 32 Vitest tests covering all 5 channel adapters and shared utilities:

- **stripMarkdown** (10 tests): bold, italic, underline, strikethrough, inline code, links, headings (# ## ###), code blocks, plain text pass-through
- **splitAtSentenceBoundary** (5 tests): within limit, sentence boundary split, word boundary fallback, `!` boundary, `?` boundary
- **formatWhatsapp** (4 tests): single chunk, markdown stripping, 3000-char split into ≤1600-char chunks (Success Criterion 5), maxChunkLength override
- **formatMeta** (3 tests): single chunk, markdown stripping, >2000-char split into ≤2000-char chunks
- **formatTelegram** (3 tests): single chunk, no split under 4096, split over 4096 into ≤4096-char chunks
- **formatManychat** (4 tests): single block, Dynamic Block v2 shape validation, markdown stripping, >640-char split
- **formatWebWidget** (3 tests): single chunk, markdown preserved, no split for long text

All 32 tests pass.

## Commits

- `test(37-04): add adapter snapshot tests for all 5 channel adapters (CHAN-01/CHAN-02)`

## Self-Check: PASSED

- `npx vitest run tests/agent-runtime-adapters.test.ts` exits 0 with 32 tests passing
- All acceptance criteria met including Success Criterion 5 (3000-char WhatsApp split)
- Dynamic Block v2 shape assertion: `expect(chunk.data.version).toBe('v2')`

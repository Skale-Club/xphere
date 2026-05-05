# Phase 16: BOUNDARY - Context

**Gathered:** 2026-05-05
**Status:** Complete

<domain>
## Phase Boundary

Document the chat data lifecycle so future contributors can answer "when is each table written, who owns each record" without reading the entire chat codebase. Two artifacts: (1) a markdown doc at `.planning/codebase/chat-data-boundary.md`, (2) header comments in source files pointing to the doc.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Doc location: `.planning/codebase/chat-data-boundary.md` (consistent with other codebase docs)
- **D-02:** Doc structure: TL;DR → tables → Redis role → widget lifecycle → Meta lifecycle → outbound replies → file map
- **D-03:** Code comments live in the file headers (right after the existing top comment) and link to the doc by relative path

</decisions>

---

*Phase: 16-boundary*
*Context gathered: 2026-05-05*

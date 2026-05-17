# Phase 18: SEARCH - Context

**Gathered:** 2026-05-05
**Status:** Complete

<domain>
## Phase Boundary

Add 300ms debouncing to the existing client-side conversation search. SEARCH-01, SEARCH-02, SEARCH-04 were already implemented in prior phases (search input + filter composition with channel/bot pills). Only SEARCH-03 (debouncing) was new.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Discovered during planning: the conversation-list component already had a fully-functional search:
  - Input box with magnifier icon (line 122)
  - useState `search` field
  - filter logic checking visitorName, visitorEmail, lastMessage (substring, lowercase)
  - Empty input → no filter (clears search)
- **D-02:** Only debouncing was missing — added a separate `debouncedSearch` state synced via `useEffect` + setTimeout(300ms)
- **D-03:** Filter logic now reads `debouncedSearch` instead of `search`, so the input updates instantly but the filter waits 300ms after typing stops

</decisions>

---

*Phase: 18-search*
*Context gathered: 2026-05-05*

# Phase 26: Rules UI + Event Log - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 26-rules-ui-event-log
**Areas discussed:** Flow selector

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Flow selector | How admins pick a ManyChat flow when creating a rule | ✓ |
| Rule form UX | Sheet vs dialog, condition builder | |
| Event log payload viewer | Sheet vs modal vs inline expand | |
| Navigation | Tabs vs sub-pages vs sidebar | |

**User's choice:** Flow selector only.
**Notes:** Other areas defer to Claude's discretion (defaults documented in CONTEXT.md).

---

## Flow selector — Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown from API | Populated by GET /fb/page/getFlows when form opens; shows names, stores flow_ns | ✓ |
| Free-text input | Admin copy-pastes flow_ns manually | |
| Dropdown with manual fallback | Load API; fall back to text input on error | |

**User's choice:** Dropdown from API.
**Notes:** Same API already called by testManychatConnection. Better UX than asking admin to locate opaque flow_ns strings.

---

## Flow selector — Data loading

| Option | Description | Selected |
|--------|-------------|----------|
| Server action on form open | getManychatFlows() called via useEffect on mount | ✓ |
| Loaded in page (server component) | Fetched at render time, passed as props | |
| Inline 'Load flows' button | Admin explicitly triggers the fetch | |

**User's choice:** Server action called on form open.
**Notes:** Flows refresh automatically each time the form opens. Mirror testManychatConnection pattern.

---

## Flow selector — Condition builder

| Option | Description | Selected |
|--------|-------------|----------|
| Key/value pair rows | Dynamic add/remove rows; saves as plain object | ✓ |
| JSON textarea | Raw JSON input; flexible but requires JSON knowledge | |
| Always empty (catch-all) | Skip condition UI entirely for Phase 26 | |

**User's choice:** Key/value pair rows.
**Notes:** Matches how Phase 23's matchesCondition works. Empty list = catch-all ({}).

---

## Ready to write CONTEXT.md

| Option | Description | Selected |
|--------|-------------|----------|
| Ready for CONTEXT.md | Capture decisions, other areas to Claude's discretion | ✓ |
| Discuss rule form UX too | Cover sheet vs dialog, delete confirmation | |

**User's choice:** Ready for CONTEXT.md.

---

## Claude's Discretion

- **Rule form:** Sheet (slide-in), single sheet for create and edit
- **Delete confirmation:** AlertDialog
- **Event log columns:** received_at, event_type, status badge, action_log_id
- **Event log payload viewer:** Sheet on row click with pretty-printed JSON
- **Pagination:** 25 per page, offset-based
- **Filters:** URL query params for shareability
- **Navigation:** Separate sub-pages with nav links from settings page
- **Tool config selector:** Select populated server-side, passed as props

## Deferred Ideas

- Rule priority drag-and-drop
- Event replay
- Bulk delete events
- Condition value type coercion
- "Tool bound to N rules" warning on tool deletion

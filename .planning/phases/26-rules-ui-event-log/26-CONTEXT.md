# Phase 26: Rules UI + Event Log - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Two new dashboard sub-pages under `/integrations/manychat/`:

1. `/integrations/manychat/rules` — CRUD UI for routing rules. Admin can create rules (event_type + condition key/value pairs + flow selector + tool_config binding), edit them, and delete them with a confirmation step.

2. `/integrations/manychat/events` — Read-only inbound event log. Admin sees a paginated list of events with status, can filter by status + date range, and clicks any row to view the full raw payload.

**In scope:** Pages, components, and any new server actions needed (getManychatFlows). All rule CRUD server actions already exist in `rule-actions.ts`.

**Out of scope:** Rule priority reordering UI (no drag-and-drop in this phase), event replay, bulk delete, advanced analytics.

</domain>

<decisions>
## Implementation Decisions

### Flow Selector

- **D-01:** The rule form's flow field uses a **dropdown populated from the ManyChat API** — not a free-text input. The dropdown shows flow names (human-readable); the stored value is `flow_ns` (the opaque namespace string like `content20250616151905_320176` that Phase 23's dispatcher uses).

- **D-02:** Flows are loaded via a **new server action `getManychatFlows()`** called when the rule form opens (client component, `useEffect` on mount). It decrypts the org's stored API key and calls `GET /fb/page/getFlows` with a 5s `AbortController` timeout. Returns `{ flows: Array<{name: string; flow_ns: string}> }` or `{ error: string }`.

  Implementation mirrors `testManychatConnection` in `src/app/(dashboard)/integrations/manychat/actions.ts:52-91` — same decrypt + fetch + 5s abort pattern. Add `getManychatFlows` to that same file.

- **D-03:** The flow dropdown loads in a **loading state** while the server action runs (spinner or "Loading flows…" placeholder). If the API call fails (channel disconnected, timeout, error), the dropdown shows a disabled "Could not load flows" option and the form shows an inline error. The form is not blocked — admin can still save (the `flow_ns` field is just invalid until a flow is selected).

### Condition Builder

- **D-04:** Rule condition (`condition` JSONB) is configured via **dynamic key/value pair rows** — not a JSON textarea, not always-empty. Each row has a text input for the key and a text input for the value. Admin can add rows (+ button) and remove them (× button per row). An empty condition list saves as `{}` (catch-all rule matching any payload for the given event_type). This matches how Phase 23's `matchesCondition` works — flat key containment.

- **D-05:** Condition values are always stored as **strings** in the JSONB. Phase 23's resolver does `payload[k] === condition[k]` — string equality. The UI need not support typed values (number, boolean) in Phase 26; if the inbound payload uses string representations, condition strings work. Note for planner: `parseInt`/`parseFloat` coercion is out of scope.

### Claude's Discretion

Undiscussed areas — planner picks documented defaults and flags in plan for review:

- **Rule form presentation:** Sheet (slide-in panel from the right). Consistent with the existing edit-form pattern in this codebase (e.g., tool-config-form is used in a dialog but a sheet feels better for a form with multiple sections). Single sheet serves both create and edit (title changes: "New Rule" vs "Edit Rule"). Form fields: event_type (text input or select of known types), condition rows (D-04), flow dropdown (D-01), tool_config selector (existing tool_configs for the org), priority (number input, default 0), is_active (toggle).

- **Delete confirmation:** Use `AlertDialog` from `src/components/ui/alert-dialog.tsx`. The confirmation text should mention that deleting the rule stops routing events matching it.

- **Event log columns:** `received_at` (formatted date), `event_type`, `status` (Badge: "matched" = green, "unmatched" = yellow, "error" = red), `action_log_id` (truncated UUID or "—" if null). Row click opens payload viewer.

- **Event log payload viewer:** Sheet (right slide-in) showing `event_payload` as pretty-printed JSON. Reuse the sheet pattern from the rule form. "Close" button to dismiss.

- **Pagination:** Server-side, 25 rows per page. Use offset-based pagination (`limit + offset` on the Supabase query). Page controls: Previous / Next buttons; no numbered page list needed.

- **Filters:** Status filter = select/dropdown (all / matched / unmatched / error). Date range = two date inputs (`input[type="date"]`). Applied via query params (`?status=error&from=2026-05-01&to=2026-05-07`) so the URL is shareable.

- **Navigation:** Separate sub-pages with links from the settings page — `/integrations/manychat` shows a row of nav links ("Settings | Rules | Events") at the top, each pointing to its sub-page. This is already implied by `revalidatePath('/integrations/manychat/rules')` in `rule-actions.ts`. No client-side tab switching needed; simple `<Link>` elements styled as tabs.

- **Tool config selector in rule form:** `<Select>` populated by a server-side fetch of `tool_configs` for the active org. Shows `tool_name` as the label, stores `id` as the value. Fetched in the page server component (not on form open), passed as props.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 26 spec
- `.planning/ROADMAP.md` § "Phase 26: Rules UI + Event Log" — goal, depends_on (Phase 23, 24), requirements (ROUTING-01/02 UI, OBS-01/02/03), 5 success criteria, UI hint: yes

### Existing code to extend
- `src/app/(dashboard)/integrations/manychat/rule-actions.ts` — **ALL 4 rule server actions already implemented** (`createManychatRule`, `updateManychatRule`, `deleteManychatRule`, `getManychatRules`). Planner does NOT need to plan these — just wire the UI to call them.
- `src/app/(dashboard)/integrations/manychat/actions.ts` — add `getManychatFlows()` here; mirrors `testManychatConnection` at line 52. Already imports `decrypt`, `createClient`, `getUser`.
- `src/app/(dashboard)/integrations/manychat/page.tsx` — existing settings page; add nav links to rules + events sub-pages.
- `src/app/(dashboard)/integrations/manychat/constants.ts` — shared types and constants for the ManyChat integration.
- `src/lib/manychat/resolve-rule.ts` — how `condition` JSONB containment matching works; informs condition UI design.

### Schema
- `src/types/database.ts` — `manychat_rules.Row` (channel_id, event_type, condition, tool_config_id, priority, is_active) and `manychat_events.Row` (event_type, status, action_log_id, event_payload, created_at)
- `supabase/migrations/027_manychat_rules.sql` — `manychat_rules` table DDL + RLS; `manychat_events` append-only insert policy

### Reference UI patterns
- `src/components/integrations/manychat-settings.tsx` — existing ManyChat settings component; visual style + form patterns for this page family
- `src/components/ui/sheet.tsx` — use for rule form + event payload viewer
- `src/components/ui/alert-dialog.tsx` — use for rule delete confirmation
- `src/components/ui/badge.tsx` — use for event status chips
- `src/components/ui/table.tsx` — use for rules list + event log

### Phase 24 reference (how the settings page was built)
- `.planning/phases/24-dashboard-config-ui/24-02-SUMMARY.md` — two-state settings page pattern (Phase 26 pages are simpler: always-visible lists)

### Project-level
- `CLAUDE.md` — server components by default, `react-hook-form` + `zod` + `zodResolver` for forms, `sonner` for toasts, RLS via `get_current_org_id()`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`rule-actions.ts` (full CRUD)** — `createManychatRule(ManychatRuleInput)`, `updateManychatRule(id, Partial<ManychatRuleInput>)`, `deleteManychatRule(id)`, `getManychatRules()`. All already implemented, already revalidate the correct paths. Phase 26 UI just calls these.
- **`testManychatConnection` pattern** — exact template for `getManychatFlows()`: decrypt key → `AbortController` 5s timeout → `fetch` with `Authorization: Bearer` → parse JSON → return typed result or error. Lives in `actions.ts:52-91`.
- **`shadcn/ui` primitives** — `Table`, `Sheet`, `AlertDialog`, `Badge`, `Select`, `Form`, `Input`, `Card` — all present in `src/components/ui/`. No new UI library installs.
- **`react-hook-form` + `zod`** — established pattern; tool-config-form.tsx is the reference implementation.

### Established Patterns

- **Server component pages** — page.tsx fetches data server-side, passes as props to client components (see `manychat/page.tsx`).
- **Server actions for mutations** — `'use server'` files in the page directory, called from client components.
- **RLS scoping** — never manual `org_id` filter; RLS handles tenant isolation automatically.
- **`sonner` toasts** — `toast.success` / `toast.error` in client components after server action returns.
- **Query params for filters** — use `useSearchParams` + `useRouter` for client-side filter state that's URL-shareable.

### Integration Points

- **`/integrations/manychat/rules/page.tsx`** — new server component. Fetches rules + tool_configs list server-side; renders `RulesTable` (client) and `RuleFormSheet` (client).
- **`/integrations/manychat/events/page.tsx`** — new server component. Fetches first page of events server-side (offset 0, limit 25); renders `EventsTable` (client) with pagination + filter state in URL params.
- **`/integrations/manychat/page.tsx`** — add nav links row pointing to `/rules` and `/events`.
- **`getManychatFlows()` server action** — called from the rule form client component on open; adds to the existing `actions.ts` file.

</code_context>

<specifics>
## Specific Ideas

- `getManychatFlows()` should return `{ flows: Array<{name: string; ns: string}> } | { error: string }` — the `ns` field maps to the `flow_ns` stored in the rule. The `name` is display-only.
- The flow dropdown label in the create/edit form: "ManyChat Flow" with a sub-label "(select the flow to trigger or bind this rule to)". The `value` stored in the form is `ns`; the `label` shown is `name`.
- Condition rows UX: show a placeholder row ("+ Add condition") when the list is empty; each existing row shows [key input] = [value input] [× remove]. The `+` button appends a blank row.
- Event log `status` badge colors: `matched` → green (`bg-green-100 text-green-800`), `unmatched` → yellow/amber, `error` → red — consistent with other status badges in the codebase.
- Event log `vapi_call_id` column: Phase 23 stored ManyChat events as `manychat:{event_id}` in the action_logs table. The event log doesn't need to show vapi_call_id directly; show `action_log_id` (truncated UUID) when present, `—` when null (unmatched/error events).

</specifics>

<deferred>
## Deferred Ideas

- Rule priority reordering UI (drag-and-drop) — future phase
- Event replay (re-dispatch a logged event) — future phase
- Bulk delete events — future phase
- Condition value type coercion (number, boolean) in the condition builder — future phase; string equality works for all current use cases
- "This tool is bound to N rules" warning before tool deletion — noted in `deleteManychatRule` comment; belongs in the tools page phase

</deferred>

---

*Phase: 26-rules-ui-event-log*
*Context gathered: 2026-05-07*

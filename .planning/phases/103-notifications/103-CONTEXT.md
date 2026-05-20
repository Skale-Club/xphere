# Phase 103: In-App Notification System - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a real-time in-app notification system: bell icon in the header (slot already exists) opens a dropdown popover with a list of events, persisted in Supabase, delivered live via Supabase Realtime.

</domain>

<decisions>
## Implementation Decisions

### Panel Style
- **D-01:** Dropdown popover (inline below the bell, estilo Linear/Gmail) — NOT a sheet or dedicated page

### Event Types
- **D-02:** Three event types in v1:
  - `new_conversation` — inbound message in any channel (WhatsApp, SMS, chat)
  - `missed_call` — call not answered or ended without connection
  - `flow_failed` — automation flow with runtime error
- **D-03:** Campanha concluída and novo contato NOT in scope for this phase

### Persistence
- **D-04:** Read notifications stay visible for 30 days, shown in a dimmer tone
- **D-05:** "Mark all as read" action required
- **D-06:** Individual mark-as-read on click

### Delivery
- **D-07:** Supabase Realtime for live delivery (channel scoped per org or per user — Claude's discretion)
- **D-08:** Notifications table in DB: per-org, per-user, with `read_at`, `created_at`, `type`, `payload` JSON

### Claude's Discretion
- Realtime channel architecture (per-user vs per-org broadcast)
- Dropdown positioning, max-height, scroll behavior
- Badge count cap (e.g., "9+" when > 9 unread)
- Auto-cleanup job for notifications older than 30 days

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Integration Points
- `src/components/layout/top-bar.tsx` — Bell icon + `hasNotifications` mock already wired; replace mock with real data
- `src/lib/supabase/client.ts` — Supabase browser client for Realtime subscription
- `src/lib/supabase/server.ts` — Server client for SSR initial fetch
- `supabase/migrations/` — Add migration for `notifications` table

### Design System
- CSS variables in `src/app/globals.css` — use `bg-bg-primary`, `border-border-subtle`, `text-text-secondary` etc.
- `src/components/ui/` — Popover, Badge, Button primitives available

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Bell` icon: already imported in `top-bar.tsx`
- `hasNotifications` mock state: replace with real unread count from DB/Realtime
- Badge dot: already rendered conditionally on `hasNotifications` — wire to real data
- `ThemeToggle`: already in top-bar — no conflict with notification bell position
- `Popover` component: available in `src/components/ui/popover.tsx` (shadcn)
- Supabase Realtime: client already configured, used in chat (`src/components/chat/`)

### Established Patterns
- Server actions for DB mutations (mark as read)
- `createClient()` from `@/lib/supabase/client` for client-side subscriptions
- RLS on all tables — `notifications` table must scope to org via `get_current_org_id()`
- Toast via `sonner` — could optionally show a toast on new notification arrival

### Integration Points
- `top-bar.tsx` — primary integration point (bell button → popover)
- New `supabase/migrations/` file for `notifications` table
- Webhook receivers (`/api/vapi/calls`, `/api/manychat/webhook`, flow runner) — these will INSERT into notifications table when events occur

</code_context>

<specifics>
## Specific Ideas

- Bell badge should show numeric count (not just a dot) when unread > 0
- Dropdown should have a "Mark all as read" button at the top
- Each notification item should be clickable and navigate to the relevant resource (conversation, call, flow run)

</specifics>

<deferred>
## Deferred Ideas

- Campanha concluída notifications — future phase
- Novo contato criado notifications — future phase
- Email/push notifications (browser push API) — separate phase
- Notification preferences per user (mute types) — future phase

</deferred>

---

*Phase: 103-notifications*
*Context gathered: 2026-05-19*

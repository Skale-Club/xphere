# Phase 103: Notifications - Research

**Researched:** 2026-05-19
**Domain:** Supabase Realtime + Next.js App Router in-app notification system
**Confidence:** HIGH

## Summary

This phase wires a fully-functional real-time in-app notification system onto an existing placeholder in `top-bar.tsx`. The bell icon slot, mock `hasNotifications` state, and conditional badge dot are already rendered — replacing them with real data is the primary integration task.

The codebase has a mature Realtime pattern established in `chat-layout.tsx`: create a browser Supabase client, open a channel scoped to `org_id`, subscribe to `postgres_changes` for INSERT/UPDATE events, and clean up on unmount. The notifications feature follows the exact same pattern. A new `notifications` table feeds the Realtime subscription; server actions handle mark-as-read mutations; webhook receivers (Vapi calls, inbound chat, flow runner) INSERT rows when events occur.

The per-user Realtime channel is preferred over per-org broadcast because RLS on `postgres_changes` requires a filter that Supabase can enforce (`user_id=eq.<uid>`). Per-org broadcast would require the service role or a separate broadcast event, adding complexity. Scoping by `user_id` is simpler and maps cleanly to the table's RLS policy.

**Primary recommendation:** Use `postgres_changes` on a per-user filtered channel (`user_id=eq.<uid>`) for INSERT events, piggy-backing on RLS-enforced row visibility. This is the same proven approach used in the chat inbox.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Dropdown popover style (inline below the bell, estilo Linear/Gmail) — NOT a sheet or dedicated page
- **D-02:** Three event types in v1: `new_conversation`, `missed_call`, `flow_failed`
- **D-03:** `campanha_concluida` and `novo_contato` NOT in scope
- **D-04:** Read notifications stay visible for 30 days, shown in a dimmer tone
- **D-05:** "Mark all as read" action required
- **D-06:** Individual mark-as-read on click
- **D-07:** Supabase Realtime for live delivery
- **D-08:** Notifications table: per-org, per-user, with `read_at`, `created_at`, `type`, `payload` JSON

### Claude's Discretion

- Realtime channel architecture (per-user vs per-org broadcast)
- Dropdown positioning, max-height, scroll behavior
- Badge count cap (e.g., "9+" when > 9 unread)
- Auto-cleanup job for notifications older than 30 days

### Deferred Ideas (OUT OF SCOPE)

- Campanha concluída notifications
- Novo contato criado notifications
- Email/push notifications (browser push API)
- Notification preferences per user (mute types)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NOTIF-01 | Notifications table in Supabase, per-org, per-user, with RLS | Migration 078 — schema, RLS policy, and Realtime publication pattern documented below |
| NOTIF-02 | Bell icon in header shows live unread count badge | Replace `hasNotifications` mock in `top-bar.tsx`; hook fetches initial count via server action then subscribes to INSERT events |
| NOTIF-03 | Dropdown popover panel with notification list | `Popover` + `PopoverContent` from `src/components/ui/popover.tsx` already available |
| NOTIF-04 | Event types: new_conversation, missed_call, flow_failed | INSERT helpers in webhook routes (`/api/vapi/calls`, chat inbound, flow runner) |
| NOTIF-05 | Mark as read (individual + mark all), 30-day history | Server actions update `read_at`; RLS policy allows owner update; display 30d window |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/ssr` | (project-pinned) | `createBrowserClient` for Realtime subscription | Already used in `src/lib/supabase/client.ts` |
| `@supabase/supabase-js` | (project-pinned) | `postgres_changes` channel subscription | Established pattern in `chat-layout.tsx` |
| `@radix-ui/react-popover` (via shadcn) | (project-pinned) | Dropdown popover primitive | Already installed; `src/components/ui/popover.tsx` exists |
| `lucide-react` | (project-pinned) | `Bell` icon (already imported in `top-bar.tsx`) | Design-system standard |
| `sonner` | (project-pinned) | Optional toast on new notification arrival | Project-wide toast library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` | (project-pinned) | `formatDistanceToNowStrict` for relative timestamps | Already used in `conversation-list.tsx` |

**Installation:** No new packages required — all dependencies are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
  components/
    notifications/
      notification-bell.tsx      # 'use client' — bell button + popover wrapper
      notification-list.tsx      # popover body — list of items + mark-all button
      notification-item.tsx      # single row (icon, message, timestamp, read state)
  app/
    (dashboard)/
      notifications/
        actions.ts               # 'use server' — fetchNotifications, markRead, markAllRead
  lib/
    notifications/
      insert.ts                  # service-role helper: insertNotification(orgId, userId, type, payload)
```

### Pattern 1: Realtime Subscription (per-user filtered postgres_changes)

**What:** Subscribe to INSERT on `notifications` table filtered by `user_id`. On each event, prepend the row to local state and increment unread count.

**When to use:** Always — the per-user filter is the only option that works cleanly with Supabase `postgres_changes` RLS enforcement.

```typescript
// Source: established pattern from src/components/chat/chat-layout.tsx
// In notification-bell.tsx (client component)
import { createClient } from '@/lib/supabase/client'

useEffect(() => {
  if (!currentUserId) return
  const supabase = createClient()
  const channel = supabase
    .channel(`notifications-${currentUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUserId}`,
      },
      (payload) => {
        const row = payload.new as NotificationRow
        setNotifications((prev) => [row, ...prev])
        setUnreadCount((n) => n + 1)
      },
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [currentUserId])
```

### Pattern 2: Server Action for Mark-as-Read

**What:** Server action that UPDATEs `read_at = now()` for one or all notifications. Called from the client component on click or "Mark all" button.

**When to use:** All DB mutations in this codebase go through server actions.

```typescript
// Source: pattern from src/app/(dashboard)/chat/actions.ts
'use server'
import { createClient, getUser } from '@/lib/supabase/server'

export async function markNotificationRead(id: string) {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }
  const supabase = await createClient()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
  // RLS ensures only the owning user's rows are updated
}

export async function markAllNotificationsRead() {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }
  const supabase = await createClient()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
}
```

### Pattern 3: Service-Role INSERT from Webhook Receivers

**What:** Webhook handlers (Vapi, inbound chat, flow runner) already use `createClient<Database>(url, SUPABASE_SERVICE_ROLE_KEY)`. Add a shared `insertNotification()` helper these handlers call.

**When to use:** Any time a triggering event is detected inside a webhook receiver.

```typescript
// src/lib/notifications/insert.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type NotificationType = 'new_conversation' | 'missed_call' | 'flow_failed'

export async function insertNotification(
  orgId: string,
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown>,
) {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  await supabase.from('notifications').insert({
    org_id: orgId,
    user_id: userId,
    type,
    payload,
  })
}
```

### Pattern 4: Initial Fetch (SSR + hydration)

**What:** On open, the popover body fetches the last 30 days of notifications via a server action. This avoids a loading flash — the popover content is available on first render.

**Alternative:** Fetch client-side on popover open (lazy). Either works; client-side fetch is simpler and avoids prop-drilling `userId` into a server component.

### Anti-Patterns to Avoid

- **Polling:** Never use `setInterval` to poll for notifications. The project has Realtime — use it.
- **Broadcasting to org channel:** Per-org broadcast requires the service role to publish and cannot leverage RLS row filtering. Per-user `postgres_changes` is cleaner.
- **Calling `supabase.auth.getUser()` directly:** Always use the cached `getUser()` from `@/lib/supabase/server`.
- **Mutating `notifications` from a client component without a server action:** All writes go through server actions per project pattern.
- **Manually filtering by `org_id` in server action queries:** RLS via `get_current_org_id()` handles org scoping automatically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Realtime delivery | Custom WebSocket or SSE server | Supabase `postgres_changes` | Already configured, RLS-aware, used in chat inbox |
| Dropdown UI | Custom positioned div | `Popover` / `PopoverContent` from shadcn | Handles positioning, portal, keyboard dismiss, animation |
| Relative timestamps | Custom formatter | `date-fns` `formatDistanceToNowStrict` | Already used in `conversation-list.tsx` |
| Badge with cap | Custom count logic | Inline: `unreadCount > 9 ? '9+' : String(unreadCount)` | One-liner — not worth abstracting |

**Key insight:** Every infrastructure piece (Realtime client, Popover, server actions, service-role inserts) is already operational in the codebase. This phase is wiring, not building from scratch.

---

## Database Migration (Migration 078)

Next migration number is **078** (last is `077_favicon_bucket.sql`).

```sql
-- Migration 078: In-app notifications table
-- NOTIF-01: per-org, per-user, with RLS

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text        NOT NULL CHECK (type IN ('new_conversation','missed_call','flow_failed')),
  payload    jsonb       NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users may SELECT/UPDATE only their own rows within the active org
DROP POLICY IF EXISTS notifications_owner ON public.notifications;
CREATE POLICY notifications_owner ON public.notifications
  FOR ALL
  USING (
    user_id = auth.uid()
    AND org_id = (SELECT public.get_current_org_id())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = (SELECT public.get_current_org_id())
  );

-- Enable Realtime for INSERT delivery
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

**Key design notes:**
- No `updated_at` column needed — only `read_at` is ever updated; a separate `updated_at` trigger is unnecessary.
- The partial index on `(user_id, created_at DESC) WHERE read_at IS NULL` makes unread-count queries fast.
- The `SECURITY DEFINER` note: service-role inserts (from webhooks) bypass RLS — this is intentional and matches the existing pattern in the codebase.
- 30-day cleanup: a Supabase Edge Function cron or a pg_cron job can `DELETE FROM notifications WHERE created_at < now() - interval '30 days'`. This is deferred per discretion; the plan should include a Wave task for it (optional / non-blocking).

---

## TopBar Integration Detail

`TopBar` in `top-bar.tsx` is already a `'use client'` component. It receives `activeOrgId` and `activeOrgName` from the dashboard layout (server component), but NOT `currentUserId`. The Realtime subscription needs `userId`.

**Two options:**

1. **Pass `userId` as a prop from layout** — cleanest, zero extra fetches. Layout already calls `getUser()`.
2. **Read user from Supabase client inside `NotificationBell`** — adds a `useEffect` + async auth call but avoids prop changes to `TopBar`.

**Recommendation:** Option 1 — add `userId: string | null` to `TopBarProps` and pass `user.id` from the layout. This is consistent with how `activeOrgId` is passed.

The bell button in `TopBar` is currently a plain `<Button>` without `onClick`. Replace it with the new `<NotificationBell>` client component that renders the full `Popover` + subscription logic.

---

## Common Pitfalls

### Pitfall 1: Realtime subscription not receiving events
**What goes wrong:** Channel subscribes but INSERT events never fire.
**Why it happens:** The `notifications` table is not in the `supabase_realtime` publication, OR the filter `user_id=eq.<uid>` does not match the actual column value (UUID vs string mismatch).
**How to avoid:** Migration 078 adds the table to the publication. Verify `user.id` is a string UUID before passing to the filter.
**Warning signs:** `channel.subscribe()` returns `SUBSCRIBED` but no events arrive.

### Pitfall 2: RLS blocks service-role inserts
**What goes wrong:** Webhook tries to INSERT a notification and gets a policy violation.
**Why it happens:** Using the anon key instead of service role key in the webhook handler.
**How to avoid:** All webhook handlers already use `SUPABASE_SERVICE_ROLE_KEY`. The shared `insertNotification()` helper must do the same — never use `createClient()` from `@/lib/supabase/client` (browser client) in a webhook receiver.
**Warning signs:** `insert` returns a 42501 RLS error in server logs.

### Pitfall 3: Popover stays open after navigation
**What goes wrong:** User clicks a notification link; popover remains mounted across navigation.
**Why it happens:** `PopoverContent` is rendered in a portal — it does not unmount on route change unless the open state is controlled.
**How to avoid:** Track popover open state in local React state. Close it (`setOpen(false)`) inside the notification item's click handler before calling `router.push()`.

### Pitfall 4: Unread count drifts after mark-as-read
**What goes wrong:** Clicking "Mark all as read" updates the DB but the badge still shows a number.
**Why it happens:** Local unread count state is not reset after the server action completes.
**How to avoid:** After the server action resolves successfully, update local state: `setUnreadCount(0)` and set all items' `read_at` to `new Date().toISOString()`.

### Pitfall 5: Missing user IDs in webhook context
**What goes wrong:** `insertNotification()` is called from a webhook but there is no `user_id` to insert — webhooks are not authenticated as a specific user.
**Why it happens:** Notifications are per-user, but webhook events (missed call, flow failed) happen at org level with no user context.
**How to avoid:** When inserting org-level events, INSERT one row per org member who should receive the notification. Fetch `org_members` where `organization_id = orgId` in the `insertNotification` helper and fan out. Alternatively, insert a single row with `user_id = null` and adjust the schema/RLS — but this breaks the RLS model. **Fan-out is the correct approach.**

---

## Code Examples

### Notification Bell Component Skeleton

```typescript
// src/components/notifications/notification-bell.tsx
'use client'

import { useState, useEffect } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createClient } from '@/lib/supabase/client'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@/app/(dashboard)/notifications/actions'
import { cn } from '@/lib/utils'

interface NotificationBellProps {
  userId: string | null
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const unreadCount = notifications.filter((n) => !n.read_at).length
  const badgeLabel = unreadCount > 9 ? '9+' : unreadCount > 0 ? String(unreadCount) : null

  // Initial load
  useEffect(() => {
    if (!userId) return
    fetchNotifications().then(setNotifications).catch(() => {})
  }, [userId])

  // Realtime subscription
  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        setNotifications((prev) => [payload.new as NotificationRow, ...prev])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative text-text-secondary hover:text-text-primary" aria-label="Notifications">
          <Bell className="h-[15px] w-[15px]" />
          {badgeLabel && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white ring-2 ring-bg-primary">
              {badgeLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        {/* NotificationList renders here */}
      </PopoverContent>
    </Popover>
  )
}
```

### Migration 078 Realtime Publication (idempotent pattern)

```sql
-- Same pattern as 024_chat_realtime_publication.sql
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

### Notification Item Navigation Target

Each notification type maps to a route:

| Type | Navigation target | Payload key |
|------|-------------------|-------------|
| `new_conversation` | `/chat?id={conversation_id}` | `payload.conversation_id` |
| `missed_call` | `/calls?highlight={call_log_id}` | `payload.call_log_id` |
| `flow_failed` | `/automations/logs?id={log_id}` | `payload.action_log_id` |

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Polling every 30s | Supabase `postgres_changes` Realtime | Already used; zero-latency delivery |
| Global notification page | Inline dropdown popover | Matches Linear/Gmail UX; less navigation friction |

---

## Open Questions

1. **Fan-out strategy for org-level events (missed_call, flow_failed)**
   - What we know: Notifications are per-user; webhook events are org-scoped without a target user.
   - What's unclear: Should all org members receive `missed_call`? Only admins? The user who owns the call settings?
   - Recommendation: Default to all org members for v1 (simple); planner should include a task to fetch `org_members` in the INSERT helper. This is the only non-trivial design gap.

2. **30-day auto-cleanup job**
   - What we know: D-04 requires notifications visible for 30 days. Auto-deletion after 30 days is left to Claude's discretion.
   - What's unclear: pg_cron vs Supabase Edge Function cron vs a GitHub Action.
   - Recommendation: A Supabase Edge Function scheduled with `pg_cron` is cleanest and fits the existing Edge Function infrastructure. This can be a low-priority final task in the plan (non-blocking for the core feature).

3. **`userId` prop threading through `TopBar`**
   - What we know: Layout already calls `getUser()` (cached). Adding `userId` to `TopBarProps` is a one-line addition.
   - What's unclear: Nothing — this is straightforward.
   - Recommendation: Add `userId: string | null` to `TopBarProps` and pass `user.id` from the layout.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is pure code and database migration changes using already-configured infrastructure. No new external dependencies.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` (or `package.json` `"test"` script) |
| Quick run command | `npx vitest run tests/notifications/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NOTIF-01 | Table schema + RLS policy isolation | integration (RLS smoke) | `npx vitest run tests/notifications/rls.test.ts` | Wave 0 |
| NOTIF-02 | Unread count increments on INSERT | unit (logic) | `npx vitest run tests/notifications/unread-count.test.ts` | Wave 0 |
| NOTIF-03 | Popover renders notification list | manual / smoke | `npm run build` passes | N/A — UI |
| NOTIF-04 | `insertNotification()` helper inserts correct type | unit | `npx vitest run tests/notifications/insert.test.ts` | Wave 0 |
| NOTIF-05 | `markNotificationRead` sets `read_at`; `markAllNotificationsRead` clears all | unit | `npx vitest run tests/notifications/actions.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/notifications/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/notifications/rls.test.ts` — covers NOTIF-01 (RLS isolation, same pattern as `tests/auth/rls-isolation.test.ts`)
- [ ] `tests/notifications/unread-count.test.ts` — covers NOTIF-02 (pure logic: count filter, badge cap "9+")
- [ ] `tests/notifications/insert.test.ts` — covers NOTIF-04 (mock supabase client, verify insert args)
- [ ] `tests/notifications/actions.test.ts` — covers NOTIF-05 (mock server actions, verify `read_at` update)

---

## Project Constraints (from CLAUDE.md)

All directives below are mandatory — the planner must verify compliance:

| Directive | Impact on This Phase |
|-----------|----------------------|
| `npm run build` after every change — catches type errors | Every wave must end with a passing build |
| Always use `createClient` + `getUser` from `@/lib/supabase/server` | Server action in `notifications/actions.ts` must use these, never raw `supabase.auth.getUser()` |
| Inbound webhooks always return HTTP 200 | `insertNotification()` called from webhook handlers must never throw — wrap in try/catch |
| `export const runtime = 'nodejs'` on all API routes | Any notification-related route handler must declare Node.js runtime |
| Server components by default; `'use client'` only when needed | `NotificationBell` is a client component (Realtime + state); `actions.ts` is `'use server'` |
| Forms use `react-hook-form` + `zod` | Not applicable — no form in this phase |
| Toasts use `sonner` | Optional toast on new notification arrival uses `toast()` from `sonner` |
| Never manually filter by `org_id` in queries through authenticated client | Mark-as-read server actions do NOT add `.eq('org_id', ...)` — RLS handles it |
| RLS on all tables | Migration 078 enables RLS on `notifications` with `get_current_org_id()` policy |
| `supabase/migrations/` — never edit old migrations; add new ones | New file: `078_notifications.sql` |

---

## Sources

### Primary (HIGH confidence)

- `src/components/chat/chat-layout.tsx` — verified Realtime `postgres_changes` subscription pattern (lines 219–252)
- `supabase/migrations/024_chat_realtime_publication.sql` — verified idempotent `ALTER PUBLICATION` pattern
- `supabase/migrations/049_security_fixes.sql` — verified `get_current_org_id()` RLS pattern
- `supabase/migrations/053_call_system.sql` — verified table DDL pattern with RLS policy
- `src/components/ui/popover.tsx` — confirmed shadcn Popover primitive available
- `src/components/layout/top-bar.tsx` — confirmed bell icon, mock state, existing badge dot
- `src/app/(dashboard)/layout.tsx` — confirmed `activeOrgId` passing pattern; `user.id` available for addition
- `src/lib/supabase/client.ts` and `server.ts` — confirmed client patterns
- `./CLAUDE.md` — all project constraints

### Secondary (MEDIUM confidence)

- `tests/chat/typing-indicator.test.ts` — test style reference for Vitest unit tests in this repo
- `src/app/(dashboard)/chat/actions.ts` — server action pattern reference

### Tertiary (LOW confidence)

- None — all findings verified against codebase source files.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed present in project
- Architecture: HIGH — Realtime pattern copied from working chat-layout implementation
- Pitfalls: HIGH — identified from actual codebase patterns and known Supabase Realtime constraints
- Database schema: HIGH — follows established migration conventions in the repo

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (stable domain — Supabase Realtime API and shadcn primitives change slowly)

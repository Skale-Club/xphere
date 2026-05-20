---
id: SEED-024
status: shipped
planted: 2026-05-20
planted_during: post-SEED-021 PWA (service worker already installed)
trigger_when: next milestone OR after SEED-021 lands in production (SW active on devices)
scope: Medium
priority: high
depends_on: [SEED-021 (PWA — service worker foundation), SEED-078 (notifications table already exists)]
---

# SEED-024: Push Notifications — Android & iOS (Chat + Missed Calls)

Delivers native push notifications to Android and iOS when:
- A new inbound chat message arrives in a conversation the agent is subscribed to
- A call is missed
- (Extensible) Any `notifications` table row is inserted for the user

**Central principle:** SEED-021 already ships the service worker. SEED-024 adds the Web Push subscription layer on top of it — no new infrastructure needed beyond a Supabase Edge Function as the push sender and the Web Push API.

## Why now

The `notifications` table (migration 078) exists and emits Realtime. The service worker (SEED-021) is already precached. The PWA is installable. The only missing piece is:
1. A way to subscribe the browser to Web Push and store the subscription server-side
2. A Supabase Edge Function (Deno) that fires `webpush.send()` when a notification is inserted

## Architecture

```
Inbound chat message → insert into notifications (type='new_conversation')
                                │
                    Supabase DB Trigger / pg_notify
                                │
                    Edge Function: push-sender
                       • queries push_subscriptions WHERE user_id = $user_id
                       • for each subscription: web-push send
                                │
                    Service Worker: push event listener
                       • self.registration.showNotification(title, options)
                       • notificationclick → focus existing tab or open /chat
```

### Push subscription flow (browser → server)

1. User installs PWA or opens it in a PWA-capable browser
2. `usePushNotifications()` hook calls `Notification.requestPermission()`
3. On grant: `navigator.serviceWorker.ready` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC })`
4. Hook POSTs `PushSubscription` JSON to `/api/push/subscribe`
5. Server action upserts into `push_subscriptions` table (keyed by `user_id + endpoint`)

### DB schema (new migration 079)

```sql
CREATE TABLE public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);
CREATE INDEX ON public.push_subscriptions (user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Users can only see/delete their own subscriptions
CREATE POLICY push_sub_owner ON public.push_subscriptions
  FOR ALL USING (user_id = auth.uid());
```

### VAPID keys

Generate once, store as Supabase secrets:
```bash
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_CONTACT=mailto:admin@xphere.app
```

The `VAPID_PUBLIC_KEY` is also stored as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (env var, safe to expose).

### Edge Function: `push-sender`

Triggered by a Postgres function + `pg_notify` on `notifications` INSERT, or called directly from server actions.

```typescript
// supabase/functions/push-sender/index.ts (Deno)
import webpush from 'npm:web-push'

webpush.setVapidDetails(
  Deno.env.get('VAPID_CONTACT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
)

Deno.serve(async (req) => {
  const { user_id, notification_id } = await req.json()
  // Load notification + subscriptions from DB (service role)
  // For each subscription: webpush.sendNotification(sub, payload)
  // On 410 Gone: delete stale subscription
  return new Response('ok')
})
```

**Invocation pattern:** Server action calls `supabase.functions.invoke('push-sender', { body: { user_id, notification_id } })` after inserting a notification. This is simpler than a DB trigger and avoids pg_notify latency.

### Service Worker additions (`src/sw.ts`)

```typescript
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'New message', {
      body: data.body,
      icon: '/api/pwa/icons/192',
      badge: '/api/pwa/icons/72',
      data: { url: data.url ?? '/chat' },
      tag: data.tag,       // dedup same conversation
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/chat'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const existing = clientList.find(c => c.url.includes(url))
      return existing ? existing.focus() : clients.openWindow(url)
    })
  )
})
```

### React hook: `usePushNotifications`

```typescript
// src/hooks/use-push-notifications.ts
'use client'
export function usePushNotifications() {
  // Returns: { supported, permission, subscribed, subscribe, unsubscribe }
  // subscribe(): requestPermission → pushManager.subscribe → POST /api/push/subscribe
  // unsubscribe(): pushManager.unsubscribe → DELETE /api/push/subscribe
}
```

### API routes

```
POST /api/push/subscribe    — upsert PushSubscription for authenticated user
DELETE /api/push/subscribe  — remove PushSubscription by endpoint
```

### UI: notification permission prompt

Small non-intrusive banner in the chat inbox (`/chat`):
- Only shown when: `Notification.permission === 'default'` AND browser supports push
- Text: "Get notified when new messages arrive"
- Button "Enable" → calls `subscribe()`
- Button "Not now" → dismissed, remembered in localStorage for 7 days

The banner does NOT use a modal or block the UI.

### Notification payloads by type

| `type` | `title` | `body` | `url` |
|--------|---------|--------|-------|
| `new_conversation` | "New message" | visitor name + first 60 chars of message | `/chat` |
| `missed_call` | "Missed call" | caller number or name | `/calls` |
| `flow_failed` | "Workflow failed" | flow name | `/workflows` |

Payloads are assembled in the push-sender Edge Function from the `notifications.payload` JSONB.

## Phases

### Phase A — Subscription Infrastructure
- Migration 079: `push_subscriptions` table
- API routes: `POST /api/push/subscribe`, `DELETE /api/push/subscribe`
- `usePushNotifications()` hook
- VAPID key generation + Supabase secrets

### Phase B — Push Sender Edge Function
- `supabase/functions/push-sender/index.ts`
- Call from `lib/notifications/insert.ts` after inserting notification
- Handle stale subscription cleanup (410 Gone)

### Phase C — Service Worker Push Events
- Add `push` + `notificationclick` listeners to `src/sw.ts`
- Payload: title, body, icon, badge, url, tag

### Phase D — Chat Inbox Prompt + Settings
- Permission banner in `/chat` page (client component)
- Settings toggle in `/settings/profile`: "Push notifications — On/Off"
- List active subscriptions with device name + revoke button

## Files

```
supabase/
  migrations/079_push_subscriptions.sql          NEW
  functions/push-sender/index.ts                  NEW

src/
  app/
    api/push/
      subscribe/route.ts                          NEW
  hooks/
    use-push-notifications.ts                     NEW
  sw.ts                                           EDIT — add push + notificationclick listeners
  lib/notifications/insert.ts                     EDIT — invoke push-sender after insert
  app/(dashboard)/settings/profile/page.tsx       EDIT — push toggle
  components/chat/push-permission-banner.tsx      NEW
```

## Platform notes

| Platform | Behavior |
|----------|----------|
| Android Chrome | Full Web Push support — works when PWA is installed or browser is open |
| iOS Safari 16.4+ | Web Push works ONLY for installed PWAs (Add to Home Screen) — not in browser tab |
| iOS Chrome | Uses Safari's WebKit engine — same restrictions as iOS Safari |
| Desktop Chrome/Firefox/Edge | Full Web Push support |
| Samsung Internet | Full Web Push support |

**iOS requirement:** The user must add the PWA to their home screen (SEED-021 makes this possible). Without installation, iOS does not deliver push. The permission prompt should note this for iOS users.

## VAPID key management

Keys never expire but should be rotated if compromised. Store only in Supabase secrets and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` env var — never commit to repo.

## Criteria for success

1. ✅ Android (Chrome, Samsung Internet): push notification delivered when tab is closed
2. ✅ iOS (Safari 16.4+, installed PWA): push notification delivered
3. ✅ Notification click opens `/chat` or focuses existing tab
4. ✅ Same conversation does not produce duplicate banners (tag dedup)
5. ✅ Stale subscriptions (410 Gone) are deleted automatically
6. ✅ Notification permission prompt shown only in `/chat`, non-blocking
7. ✅ User can revoke push from `/settings/profile`
8. ✅ `npm run build` passes without errors

## Open questions (resolve at planning time)

- **Scope: all users or opt-in?** Current design is opt-in via prompt. Could be opt-out if operators prefer.
- **Notification grouping:** Should multiple messages from the same conversation collapse into one badge? Tag dedup handles this; `renotify: true` re-rings for each — consider making this configurable.
- **iOS 16.4 minimum version gate:** Show a "install the app" prompt on older iOS instead of the permission prompt?
- **Web Push vs native SDKs:** Web Push covers both platforms without a native app. If a native app is ever built (React Native), this can be replaced by FCM/APNs. For now, Web Push is the right choice.

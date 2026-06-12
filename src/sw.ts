import { Serwist, CacheFirst, NetworkOnly, ExpirationPlugin } from 'serwist'

declare const self: EventTarget & {
  __SW_MANIFEST: (string | { url: string; revision: string | null })[]
  registration: {
    showNotification: (
      title: string,
      options?: NotificationOptions & {
        renotify?: boolean
        vibrate?: number[]
        actions?: { action: string; title: string }[]
      },
    ) => Promise<void>
  }
  clients: {
    matchAll: (options?: { type?: string; includeUncontrolled?: boolean }) => Promise<{ url: string; focus: () => Promise<unknown> }[]>
    openWindow: (url: string) => Promise<unknown>
  }
  caches: {
    keys: () => Promise<string[]>
    delete: (cacheName: string) => Promise<boolean>
  }
}

const STALE_NEXT_CACHE_NAMES = [
  'next-static-js-assets',
  'static-js-assets',
  'static-style-assets',
  'next-data',
  'pages-rsc-prefetch',
  'pages-rsc',
  'pages',
  'others',
  'apis',
]

interface SWExtendableEvent extends Event {
  waitUntil: (promise: Promise<unknown>) => void
}

self.addEventListener('activate', (event: Event) => {
  const activateEvent = event as SWExtendableEvent
  activateEvent.waitUntil(
    self.caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => STALE_NEXT_CACHE_NAMES.some((stale) => name.includes(stale)))
            .map((name) => self.caches.delete(name)),
        ),
      )
      .then(() => undefined),
  )
})

// Web Push types not available in standard tsconfig lib in this context
interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
}
interface PushMessageData {
  json: () => PushPayload
}
interface PushEvent extends Event {
  data: PushMessageData | null
  waitUntil: (promise: Promise<unknown>) => void
}
interface NotificationData {
  url?: string
}
interface SWNotification {
  close: () => void
  data: NotificationData
}
interface NotificationEvent extends Event {
  notification: SWNotification
  action?: string
  waitUntil: (promise: Promise<unknown>) => void
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin && pathname.startsWith('/_next/static/'),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && request.headers.get('RSC') === '1',
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ request, sameOrigin, url: { pathname } }) =>
        sameOrigin &&
        request.mode === 'navigate' &&
        !pathname.startsWith('/api/'),
      handler: new NetworkOnly(),
    },
    {
      matcher: /^\/api\/pwa\/icons\//,
      handler: new CacheFirst({
        cacheName: 'pwa-icons',
        plugins: [new ExpirationPlugin({ maxAgeSeconds: 86400 })],
      }),
    },
    {
      matcher: /^\/api\//,
      handler: new NetworkOnly(),
    },
  ],
})

serwist.addEventListeners()

// SEED-024: Web Push event handlers.
// Incoming-call pushes (tag prefixed "incoming-") render as a persistent ringing
// notification — it stays on screen (requireInteraction), buzzes, and offers
// Answer/Decline — so a backgrounded PWA "rings" alongside the parallel PSTN leg.
self.addEventListener('push', (event: Event) => {
  const pushEvent = event as PushEvent
  const data = pushEvent.data?.json?.() ?? {}
  const tag = data.tag
  const isIncomingCall = typeof tag === 'string' && tag.startsWith('incoming-')

  pushEvent.waitUntil(
    self.registration.showNotification(data.title ?? 'New message', {
      body: data.body ?? '',
      icon: '/api/pwa/icons/192',
      badge: '/api/pwa/icons/72',
      data: { url: data.url ?? '/inbox' },
      tag,
      renotify: true,
      ...(isIncomingCall
        ? {
            requireInteraction: true,
            vibrate: [400, 200, 400, 200, 400],
            actions: [
              { action: 'answer', title: 'Atender' },
              { action: 'decline', title: 'Recusar' },
            ],
          }
        : {}),
    }),
  )
})

self.addEventListener('notificationclick', (event: Event) => {
  const notifEvent = event as NotificationEvent
  notifEvent.notification.close()

  // "Decline" just dismisses the ring — the parallel PSTN/forward leg and the
  // dial timeout still govern the real call outcome.
  if (notifEvent.action === 'decline') return

  const url: string = notifEvent.notification.data?.url ?? '/inbox'
  notifEvent.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const existing = clientList.find((c) => c.url.includes(url))
        return existing ? existing.focus() : self.clients.openWindow(url)
      }),
  )
})

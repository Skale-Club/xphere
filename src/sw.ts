import { defaultCache } from '@serwist/next/worker'
import { Serwist, CacheFirst, NetworkOnly, ExpirationPlugin } from 'serwist'

declare const self: EventTarget & {
  __SW_MANIFEST: (string | { url: string; revision: string | null })[]
  registration: {
    showNotification: (title: string, options?: NotificationOptions & { renotify?: boolean }) => Promise<void>
  }
  clients: {
    matchAll: (options?: { type?: string; includeUncontrolled?: boolean }) => Promise<{ url: string; focus: () => Promise<unknown> }[]>
    openWindow: (url: string) => Promise<unknown>
  }
}

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
  waitUntil: (promise: Promise<unknown>) => void
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
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
    ...defaultCache,
  ],
})

serwist.addEventListeners()

// SEED-024: Web Push event handlers
self.addEventListener('push', (event: Event) => {
  const pushEvent = event as PushEvent
  const data = pushEvent.data?.json?.() ?? {}
  pushEvent.waitUntil(
    self.registration.showNotification(data.title ?? 'New message', {
      body: data.body ?? '',
      icon: '/api/pwa/icons/192',
      badge: '/api/pwa/icons/72',
      data: { url: data.url ?? '/chat' },
      tag: data.tag,
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event: Event) => {
  const notifEvent = event as NotificationEvent
  notifEvent.notification.close()
  const url: string = notifEvent.notification.data?.url ?? '/chat'
  notifEvent.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const existing = clientList.find((c) => c.url.includes(url))
        return existing ? existing.focus() : self.clients.openWindow(url)
      }),
  )
})

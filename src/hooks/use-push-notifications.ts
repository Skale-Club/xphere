'use client'

import { useState, useEffect, useCallback } from 'react'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

type PermissionState = 'default' | 'granted' | 'denied'

interface PushNotificationsState {
  supported: boolean
  permission: PermissionState
  subscribed: boolean
  loading: boolean
  subscribe: () => Promise<boolean>
  unsubscribe: () => Promise<void>
}

export function usePushNotifications(): PushNotificationsState {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState<PermissionState>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const isSupported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window

    setSupported(isSupported)

    if (isSupported) {
      setPermission(Notification.permission as PermissionState)

      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setSubscribed(!!sub)
        })
      })
    }
  }, [])

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false

    setLoading(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm as PermissionState)

      if (perm !== 'granted') return false

      const reg = await navigator.serviceWorker.ready
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        console.error('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set')
        return false
      }

      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })

      const subJson = subscription.toJSON()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        }),
      })

      if (!res.ok) {
        console.error('[push] subscribe API error:', await res.text())
        await subscription.unsubscribe()
        return false
      }

      setSubscribed(true)
      return true
    } catch (err) {
      console.error('[push] subscribe error:', err)
      return false
    } finally {
      setLoading(false)
    }
  }, [supported])

  const unsubscribe = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.getSubscription()
      if (!subscription) return

      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })

      await subscription.unsubscribe()
      setSubscribed(false)
    } catch (err) {
      console.error('[push] unsubscribe error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  return { supported, permission, subscribed, loading, subscribe, unsubscribe }
}

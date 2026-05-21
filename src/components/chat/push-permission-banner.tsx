'use client'

import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { toast } from 'sonner'

const DISMISS_KEY = 'push_banner_dismissed_until'

function isDismissed(): boolean {
  try {
    const until = localStorage.getItem(DISMISS_KEY)
    if (!until) return false
    return Date.now() < parseInt(until, 10)
  } catch {
    return false
  }
}

function dismissFor7Days(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000))
  } catch {
    // ignore
  }
}

export function PushPermissionBanner() {
  const { supported, permission, subscribed, loading, subscribe } = usePushNotifications()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Only show when: push is supported, not yet granted/denied, not already subscribed, not dismissed
    if (supported && permission === 'default' && !subscribed && !isDismissed()) {
      setVisible(true)
    }
  }, [supported, permission, subscribed])

  if (!visible) return null

  async function handleEnable() {
    const granted = await subscribe()
    if (granted) {
      toast.success('Notifications enabled')
      setVisible(false)
    } else {
      toast.error('Notifications blocked | check your browser settings')
      setVisible(false)
    }
  }

  function handleDismiss() {
    dismissFor7Days()
    setVisible(false)
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-accent-muted border-b border-border-subtle shrink-0">
      <Bell className="h-4 w-4 text-accent shrink-0" />
      <p className="flex-1 text-[13px] text-text-secondary">
        Get notified when new messages arrive
        {typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && (
          <span className="text-text-tertiary"> | requires installing the app first</span>
        )}
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={loading}
          onClick={handleEnable}
        >
          Enable
        </Button>
        <button
          onClick={handleDismiss}
          className="text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

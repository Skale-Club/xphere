'use client'

import * as React from 'react'
import { BellOff, BellRing, Loader2, Smartphone } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { cn } from '@/lib/utils'

/**
 * "Ring on this device" card for the My Phone modal. Shows whether THIS
 * browser/PWA holds a live push subscription (the thing that makes a
 * backgrounded PWA ring) and lets the user enable/disable it in place.
 */
export function PushDeviceSection() {
  const { supported, permission, subscribed, loading, subscribe, unsubscribe } =
    usePushNotifications()

  const handleEnable = async () => {
    const ok = await subscribe()
    if (ok) toast.success('This device will now ring for incoming calls.')
    else if (Notification.permission === 'denied')
      toast.error('Notifications are blocked for this site — allow them in your browser settings.')
    else toast.error('Could not enable notifications on this device.')
  }

  const handleDisable = async () => {
    await unsubscribe()
    toast.success('This device will no longer ring.')
  }

  const active = supported && permission === 'granted' && subscribed

  return (
    <div
      className={cn(
        'rounded-[12px] border px-4 py-3.5',
        active
          ? 'border-emerald-500/25 bg-emerald-500/[0.05]'
          : 'border-amber-400/25 bg-amber-400/[0.06]',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]',
            active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300',
          )}
        >
          {active ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-text-primary">
            {active ? 'This device rings for incoming calls' : 'This device does not ring yet'}
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-text-secondary">
            {!supported
              ? 'Push is not available in this browser. On iPhone, install the app to your home screen first (Share → Add to Home Screen).'
              : active
                ? 'Incoming calls routed to you show a ringing notification here, even with the app in the background.'
                : 'Enable notifications so incoming calls can ring this device when the app is in the background.'}
          </p>
        </div>
        {supported && (
          <Button
            size="sm"
            variant={active ? 'outline' : 'default'}
            className="shrink-0 gap-1.5"
            disabled={loading}
            onClick={active ? handleDisable : handleEnable}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Smartphone className="h-3.5 w-3.5" />
            )}
            {active ? 'Disable' : 'Enable on this device'}
          </Button>
        )}
      </div>
    </div>
  )
}

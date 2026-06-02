'use client'

import * as React from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NotificationList } from './notification-list'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationRow,
} from '@/app/(dashboard)/notifications/actions'

/** Play a simple ring tone using the Web Audio API. Returns a stop function. */
function playRingtone(): () => void {
  if (typeof window === 'undefined' || !('AudioContext' in window || 'webkitAudioContext' in window)) {
    return () => {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioCtx = (window as any).AudioContext ?? (window as any).webkitAudioContext
  const ctx = new AudioCtx() as AudioContext
  let stopped = false

  function ring(startAt: number) {
    if (stopped) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 440
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(0.18, startAt + 0.05)
    gain.gain.linearRampToValueAtTime(0, startAt + 0.4)
    osc.start(startAt)
    osc.stop(startAt + 0.45)
    if (!stopped) setTimeout(() => ring(ctx.currentTime + 0.1), 900)
  }

  ring(ctx.currentTime)
  return () => {
    stopped = true
    ctx.close().catch(() => {})
  }
}

interface NotificationBellProps {
  userId: string | null
}

/**
 * Derives the badge label from unread count.
 * Exported so unit tests can import and verify the logic directly.
 */
export function getBadgeLabel(unreadCount: number): string | null {
  if (unreadCount > 9) return '9+'
  if (unreadCount > 0) return String(unreadCount)
  return null
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const [notifications, setNotifications] = React.useState<NotificationRow[]>([])
  const [open, setOpen] = React.useState(false)
  const instanceId = React.useId().replace(/:/g, '')

  const unreadCount = notifications.filter((n) => !n.read_at).length
  const badgeLabel = getBadgeLabel(unreadCount)

  // Initial fetch on mount
  React.useEffect(() => {
    if (!userId) return
    fetchNotifications().then((data) => setNotifications(data))
  }, [userId])

  // Realtime subscription: prepend new notifications on INSERT
  React.useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    const channel = supabase.channel(`notifications:${userId}:${instanceId}`)
    let stopRingtone: (() => void) | null = null

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const newRow = payload.new as NotificationRow
        setNotifications((prev) => [newRow, ...prev])

        if (newRow.type === 'incoming_call') {
          const p = newRow.payload as Record<string, unknown>
          const caller = (p.caller_name as string | undefined)
            ?? (p.caller_number as string | undefined)
            ?? 'Unknown'
          stopRingtone?.()
          stopRingtone = playRingtone()
          toast(`Incoming call from ${caller}`, {
            duration: 30000,
            icon: '📞',
            action: {
              label: 'View calls',
              onClick: () => { window.location.href = '/calls' },
            },
            onDismiss: () => { stopRingtone?.(); stopRingtone = null },
            onAutoClose: () => { stopRingtone?.(); stopRingtone = null },
          })
        }
      },
    )

    channel.subscribe()

    return () => {
      stopRingtone?.()
      void supabase.removeChannel(channel)
    }
  }, [instanceId, userId])

  const handleMarkOne = async (id: string) => {
    await markNotificationRead(id)
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n,
      ),
    )
  }

  const handleMarkAll = async () => {
    await markAllNotificationsRead()
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Notifications"
          className="relative text-text-secondary hover:text-text-primary"
        >
          <Bell className="h-[15px] w-[15px]" />
          {badgeLabel && (
            <span
              className="absolute -right-0.5 -top-0.5 flex min-w-4 h-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white ring-2 ring-bg-primary"
              aria-label={`${unreadCount} unread notifications`}
            >
              {badgeLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <NotificationList
          notifications={notifications}
          onMarkAll={handleMarkAll}
          onMarkOne={handleMarkOne}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

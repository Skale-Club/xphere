'use client'

import * as React from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NotificationList } from './notification-list'
import { getTabOrgId } from '@/lib/org/tab-org'
import { usePolling } from '@/hooks/use-polling'
import { POLL_NOTIFICATIONS_MS } from '@/lib/polling/intervals'
import { toast } from 'sonner'
import {
  fetchNotifications,
  fetchNotificationsSince,
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

/**
 * A ringing toast is only useful while the call is still ringing. Polling can
 * deliver an incoming_call row up to a poll interval late, so rows older than
 * this still appear in the list but no longer ring.
 */
export const INCOMING_CALL_MAX_AGE_MS = 60_000

export function isFreshIncomingCall(row: NotificationRow, now = Date.now()): boolean {
  if (row.type !== 'incoming_call') return false
  const age = now - new Date(row.created_at).getTime()
  return Number.isFinite(age) && age < INCOMING_CALL_MAX_AGE_MS
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const [notifications, setNotifications] = React.useState<NotificationRow[]>([])
  const [open, setOpen] = React.useState(false)

  const unreadCount = notifications.filter((n) => !n.read_at).length
  const badgeLabel = getBadgeLabel(unreadCount)

  // `created_at` of the newest notification seen (exactly as the server sent
  // it, so the next poll's `gt` filter loses no precision). Null until the
  // initial fetch lands, which also gates polling.
  const newestCreatedAtRef = React.useRef<string | null>(null)
  const initialLoadedRef = React.useRef(false)
  const stopRingtoneRef = React.useRef<(() => void) | null>(null)

  // Initial fetch on mount
  React.useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetchNotifications().then((data) => {
      if (cancelled) return
      newestCreatedAtRef.current = data[0]?.created_at ?? null
      initialLoadedRef.current = true
      setNotifications(data)
    })
    return () => {
      cancelled = true
      initialLoadedRef.current = false
    }
  }, [userId])

  // Stop a ringing tone when the bell unmounts.
  React.useEffect(() => () => {
    stopRingtoneRef.current?.()
    stopRingtoneRef.current = null
  }, [])

  // Poll for new notifications (replaces the Realtime INSERT subscription):
  // prepend them, and ring + toast for incoming calls.
  usePolling(
    async () => {
      if (!initialLoadedRef.current) return
      const fresh = await fetchNotificationsSince(newestCreatedAtRef.current)
      if (fresh.length === 0) return
      // Rows arrive newest first. Advance the cursor over everything seen,
      // including other orgs' rows that this tab does not show.
      newestCreatedAtRef.current = fresh[0].created_at
      // The server returns this user's notifications from every org they
      // belong to; this tab shows only its own org's.
      const tabOrgId = getTabOrgId()
      const mine = tabOrgId ? fresh.filter((n) => n.org_id === tabOrgId) : fresh
      if (mine.length === 0) return
      setNotifications((prev) => {
        const known = new Set(prev.map((n) => n.id))
        const added = mine.filter((n) => !known.has(n.id))
        return added.length > 0 ? [...added, ...prev] : prev
      })

      // Oldest first, so the newest call is the one left ringing.
      for (const row of [...mine].reverse()) {
        if (!isFreshIncomingCall(row)) continue
        const p = row.payload as Record<string, unknown>
        const caller = (p.caller_name as string | undefined)
          ?? (p.caller_number as string | undefined)
          ?? 'Unknown'
        stopRingtoneRef.current?.()
        stopRingtoneRef.current = playRingtone()
        toast(`Incoming call from ${caller}`, {
          duration: 30000,
          icon: '📞',
          action: {
            label: 'View calls',
            onClick: () => { window.location.href = '/calls' },
          },
          onDismiss: () => { stopRingtoneRef.current?.(); stopRingtoneRef.current = null },
          onAutoClose: () => { stopRingtoneRef.current?.(); stopRingtoneRef.current = null },
        })
      }
    },
    { intervalMs: POLL_NOTIFICATIONS_MS, enabled: Boolean(userId), immediate: false },
  )

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

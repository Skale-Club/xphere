'use client'

import * as React from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NotificationList } from './notification-list'
import { createClient } from '@/lib/supabase/client'
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationRow,
} from '@/app/(dashboard)/notifications/actions'

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

  const unreadCount = notifications.filter((n) => !n.read_at).length
  const badgeLabel = getBadgeLabel(unreadCount)

  // Initial fetch on mount
  React.useEffect(() => {
    if (!userId) return
    fetchNotifications().then((data) => setNotifications(data))
  }, [userId])

  // Realtime subscription: prepend new notifications on INSERT
  const subscribedRef = React.useRef(false)
  React.useEffect(() => {
    if (!userId || subscribedRef.current) return
    subscribedRef.current = true

    const supabase = createClient()
    const channel = supabase.channel(`notifications:${userId}`)

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
      },
    )

    channel.subscribe()

    return () => {
      subscribedRef.current = false
      channel.unsubscribe()
    }
  }, [userId])

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

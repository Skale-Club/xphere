'use client'

import { Button } from '@/components/ui/button'
import { NotificationItem } from './notification-item'
import type { NotificationRow } from '@/app/(dashboard)/notifications/actions'

interface NotificationListProps {
  notifications: NotificationRow[]
  onMarkAll: () => void
  onMarkOne: (id: string) => void
  onClose: () => void
}

export function NotificationList({
  notifications,
  onMarkAll,
  onMarkOne,
  onClose,
}: NotificationListProps) {
  const unreadCount = notifications.filter((n) => !n.read_at).length

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Notifications</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto py-1 text-xs text-text-secondary"
          disabled={unreadCount === 0}
          onClick={onMarkAll}
        >
          Mark all as read
        </Button>
      </div>

      {/* Notification list */}
      <div className="max-h-96 overflow-y-auto divide-y divide-border-subtle">
        {notifications.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-tertiary">
            No notifications
          </div>
        ) : (
          notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onRead={onMarkOne}
              onClose={onClose}
            />
          ))
        )}
      </div>
    </div>
  )
}
